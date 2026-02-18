#![allow(async_fn_in_trait)]

mod config;
mod delivery;
mod domain;
mod repository;
mod telemetry;
mod usecase;

use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    extract::State,
    middleware,
    routing::{delete, get, post, put},
    Router,
};
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use crate::delivery::http::v1::admin::{get_routes_stats, list_admin_routes, list_admin_comments};
use crate::delivery::http::v1::categories::{list_categories, create_category, update_category, delete_category};
use crate::delivery::http::v1::chat::{send_chat_message, get_chat_history, list_conversations, delete_conversation, chat_health};
use crate::delivery::http::v1::notifications::{list_notifications, get_unread_count, mark_as_read, mark_all_as_read};
use crate::delivery::http::v1::settings::{get_difficulty_thresholds, set_difficulty_thresholds};
use crate::delivery::http::v1::comments::{count_comments, create_comment, delete_comment, list_comments};
use crate::delivery::http::v1::likes::{get_like_count, get_user_like_status, toggle_like};
use crate::delivery::http::v1::middleware::auth_middleware;
use crate::delivery::http::v1::ratings::{get_rating_aggregate, get_user_rating, remove_rating, set_rating};
use crate::delivery::http::v1::routes::{create_route, delete_route, disable_share, enable_share, explore_routes, get_route, get_shared_route, import_route_from_geojson, list_routes, update_route};
use crate::delivery::http::v1::ws::websocket_handler;
use crate::repository::postgres::{create_pool, PostgresCategoryRepository, PostgresChatMessageRepository, PostgresCommentRepository, PostgresLikeRepository, PostgresNotificationRepository, PostgresRatingRepository, PostgresRouteRepository, PostgresSettingsRepository};
use crate::usecase::categories::CategoriesUseCase;
use crate::usecase::chat::ChatUseCase;
use crate::usecase::comments::CommentsUseCase;
use crate::usecase::notifications::NotificationsUseCase;
use crate::usecase::jwt::JwtService;
use crate::usecase::likes::LikesUseCase;
use crate::usecase::ollama::OllamaClient;
use crate::usecase::ratings::RatingsUseCase;
use crate::usecase::routes::RoutesUseCase;
use crate::usecase::settings::SettingsUseCase;

pub struct AppState {
    pub routes_usecase: RoutesUseCase<PostgresRouteRepository>,
    pub comments_usecase: CommentsUseCase<PostgresCommentRepository, PostgresRouteRepository>,
    pub likes_usecase: LikesUseCase<PostgresLikeRepository, PostgresRouteRepository>,
    pub ratings_usecase: RatingsUseCase<PostgresRatingRepository, PostgresRouteRepository>,
    pub settings_usecase: SettingsUseCase<PostgresSettingsRepository>,
    pub categories_usecase: CategoriesUseCase<PostgresCategoryRepository>,
    pub notifications_usecase: NotificationsUseCase<PostgresNotificationRepository>,
    pub chat_usecase: ChatUseCase<PostgresChatMessageRepository, PostgresRouteRepository>,
    pub jwt_service: JwtService,
    pub metrics_handle: PrometheusHandle,
    pub nats_client: Option<async_nats::Client>,
    pub ws_channels: Arc<RwLock<HashMap<Uuid, broadcast::Sender<String>>>>,
    pub chat_rate_limits: Arc<RwLock<HashMap<Uuid, (std::time::Instant, u32)>>>,
    pub chat_rate_limit_max: u32,
    pub chat_rate_limit_window_secs: u64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = config::AppConfig::from_env();

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    // Initialize tracing subscriber with optional OpenTelemetry layer
    if config.telemetry_enabled {
        let telemetry_config = telemetry::TelemetryConfig {
            service_name: config.telemetry_service_name.clone(),
            service_version: config.telemetry_service_version.clone(),
            environment: config.telemetry_environment.clone(),
            otlp_endpoint: config.telemetry_otlp_endpoint.clone(),
        };

        telemetry::init_telemetry_with_subscriber(&telemetry_config, env_filter)
            .expect("failed to initialize telemetry");
    } else {
        telemetry::init_subscriber_without_telemetry(env_filter);
    }

    tracing::info!("starting the routes service");

    let metrics_handle = PrometheusBuilder::new()
        .install_recorder()
        .expect("failed to install Prometheus recorder");
    metrics_process::Collector::default().describe();
    tracing::info!("prometheus metrics initialized");

    tracing::info!("config loaded, telemetry_enabled={}", config.telemetry_enabled);

    let pool = create_pool(&config.database_url, config.database_max_connections)
        .await
        .expect("failed to create database pool");
    tracing::info!("database pool created");

    sqlx::migrate!().run(&pool).await?;
    tracing::info!("database migrations applied");

    let route_repository = PostgresRouteRepository::new(pool.clone());
    let comment_repository = PostgresCommentRepository::new(pool.clone());
    let route_repository_for_comments = PostgresRouteRepository::new(pool.clone());
    let like_repository = PostgresLikeRepository::new(pool.clone());
    let route_repository_for_likes = PostgresRouteRepository::new(pool.clone());
    let rating_repository = PostgresRatingRepository::new(pool.clone());
    let route_repository_for_ratings = PostgresRouteRepository::new(pool.clone());
    let settings_repository = PostgresSettingsRepository::new(pool.clone());
    let category_repository = PostgresCategoryRepository::new(pool.clone());
    let notification_repository = PostgresNotificationRepository::new(pool.clone());
    let chat_message_repository = PostgresChatMessageRepository::new(pool.clone());
    let route_repository_for_chat = PostgresRouteRepository::new(pool);
    let jwt_service = JwtService::new(config.jwt_secret);
    let routes_usecase = RoutesUseCase::new(route_repository);
    let comments_usecase = CommentsUseCase::new(comment_repository, route_repository_for_comments);
    let likes_usecase = LikesUseCase::new(like_repository, route_repository_for_likes);
    let ratings_usecase = RatingsUseCase::new(rating_repository, route_repository_for_ratings);
    let settings_usecase = SettingsUseCase::new(settings_repository);
    let categories_usecase = CategoriesUseCase::new(category_repository);
    let notifications_usecase = NotificationsUseCase::new(notification_repository);

    // Create Ollama client (optional — chat works without it)
    let ollama_client = {
        let client = OllamaClient::new(config.ollama_url.clone(), config.ollama_model.clone());
        tracing::info!(
            ollama_url = %config.ollama_url,
            ollama_model = %config.ollama_model,
            "OllamaClient configured"
        );
        Some(client)
    };

    let chat_usecase = ChatUseCase::new(
        chat_message_repository,
        route_repository_for_chat,
        ollama_client,
        config.nominatim_url.clone(),
        config.chat_max_tool_iterations,
        config.chat_max_message_length,
    );
    tracing::info!("ChatUseCase initialized");

    // Connect to NATS and setup JetStream
    let nats_client = match async_nats::connect(&config.nats_url).await {
        Ok(client) => {
            tracing::info!(nats_url = %config.nats_url, "connected to NATS");

            // Create JetStream stream for photo processing
            let jetstream = async_nats::jetstream::new(client.clone());
            match jetstream
                .get_or_create_stream(async_nats::jetstream::stream::Config {
                    name: "PHOTOS".to_string(),
                    subjects: vec!["photos.process".to_string()],
                    retention: async_nats::jetstream::stream::RetentionPolicy::WorkQueue,
                    ..Default::default()
                })
                .await
            {
                Ok(_) => tracing::info!("NATS JetStream stream 'PHOTOS' ready"),
                Err(e) => tracing::error!(error = %e, "failed to create NATS JetStream stream"),
            }

            Some(client)
        }
        Err(e) => {
            tracing::warn!(error = %e, nats_url = %config.nats_url, "failed to connect to NATS, photo processing will be unavailable");
            None
        }
    };

    let ws_channels: Arc<RwLock<HashMap<Uuid, broadcast::Sender<String>>>> =
        Arc::new(RwLock::new(HashMap::new()));

    let chat_rate_limits: Arc<RwLock<HashMap<Uuid, (std::time::Instant, u32)>>> =
        Arc::new(RwLock::new(HashMap::new()));

    let shared_state = Arc::new(AppState {
        routes_usecase,
        comments_usecase,
        likes_usecase,
        ratings_usecase,
        settings_usecase,
        categories_usecase,
        notifications_usecase,
        chat_usecase,
        jwt_service,
        metrics_handle,
        nats_client,
        ws_channels: ws_channels.clone(),
        chat_rate_limits,
        chat_rate_limit_max: config.chat_rate_limit_max,
        chat_rate_limit_window_secs: config.chat_rate_limit_window_secs,
    });

    // Spawn NATS subscriber for photo completion events (core NATS, not JetStream)
    if let Some(ref client) = shared_state.nats_client {
        let nats_client = client.clone();
        let channels = ws_channels.clone();
        tokio::spawn(async move {
            tracing::info!("subscribing to photos.completed.* for WS notifications");
            match nats_client.subscribe("photos.completed.*").await {
                Ok(mut subscriber) => {
                    tracing::info!("NATS subscriber for photo completions ready");
                    use futures::StreamExt;
                    while let Some(msg) = subscriber.next().await {
                        let subject = msg.subject.as_str();
                        let route_id_str = match subject.strip_prefix("photos.completed.") {
                            Some(id) => id,
                            None => {
                                tracing::warn!(subject = %subject, "unexpected subject format");
                                continue;
                            }
                        };
                        let route_id = match route_id_str.parse::<Uuid>() {
                            Ok(id) => id,
                            Err(e) => {
                                tracing::warn!(
                                    route_id = %route_id_str,
                                    error = %e,
                                    "failed to parse route_id from NATS subject"
                                );
                                continue;
                            }
                        };

                        let payload = match String::from_utf8(msg.payload.to_vec()) {
                            Ok(s) => s,
                            Err(e) => {
                                tracing::warn!(
                                    route_id = %route_id,
                                    error = %e,
                                    "invalid UTF-8 in NATS message payload"
                                );
                                continue;
                            }
                        };

                        let channels_read = channels.read().await;
                        if let Some(tx) = channels_read.get(&route_id) {
                            let receiver_count = tx.receiver_count();
                            match tx.send(payload) {
                                Ok(_) => {
                                    tracing::info!(
                                        route_id = %route_id,
                                        receivers = receiver_count,
                                        "forwarded photo completion to WS clients"
                                    );
                                }
                                Err(_) => {
                                    tracing::debug!(
                                        route_id = %route_id,
                                        "no active WS receivers for route"
                                    );
                                }
                            }
                        } else {
                            tracing::debug!(
                                route_id = %route_id,
                                "no WS channel for route, skipping"
                            );
                        }
                    }
                    tracing::warn!("NATS photo completion subscriber ended");
                }
                Err(e) => {
                    tracing::error!(error = %e, "failed to subscribe to photos.completed.*");
                }
            }
        });
    }

    // All routes require authentication
    let routes_api = Router::new()
        .route("/api/v1/routes", get(list_routes).post(create_route))
        .route("/api/v1/routes/import", post(import_route_from_geojson))
        .route(
            "/api/v1/routes/{id}",
            get(get_route).put(update_route).delete(delete_route),
        )
        .route("/api/v1/routes/{id}/share", post(enable_share).delete(disable_share))
        .route("/api/v1/routes/{route_id}/comments", post(create_comment))
        .route("/api/v1/comments/{comment_id}", delete(delete_comment))
        .route("/api/v1/routes/{route_id}/like", post(toggle_like))
        .route("/api/v1/routes/{route_id}/like/me", get(get_user_like_status))
        .route("/api/v1/routes/{route_id}/rating", put(set_rating).delete(remove_rating))
        .route("/api/v1/routes/{route_id}/rating/me", get(get_user_rating))
        .route("/api/v1/admin/routes/stats", get(get_routes_stats))
        .route("/api/v1/admin/routes", get(list_admin_routes))
        .route("/api/v1/admin/comments", get(list_admin_comments))
        .route("/api/v1/admin/categories", post(create_category))
        .route("/api/v1/admin/categories/{id}", put(update_category).delete(delete_category))
        .route("/api/v1/notifications", get(list_notifications))
        .route("/api/v1/notifications/unread-count", get(get_unread_count))
        .route("/api/v1/notifications/{id}/read", post(mark_as_read))
        .route("/api/v1/notifications/read-all", post(mark_all_as_read))
        .route("/api/v1/admin/settings/difficulty", put(set_difficulty_thresholds))
        .route("/api/v1/chat", get(list_conversations).post(send_chat_message))
        .route("/api/v1/chat/{conversation_id}", get(get_chat_history).delete(delete_conversation))
        .layer(middleware::from_fn_with_state(
            shared_state.clone(),
            auth_middleware,
        ));

    let router = Router::new()
        .route("/healthz", get(healthz))
        .route("/metrics", get(metrics))
        .route("/api/v1/routes/explore", get(explore_routes))
        .route("/api/v1/shared/{token}", get(get_shared_route))
        .route("/api/v1/routes/{route_id}/ws", get(websocket_handler))
        .route("/api/v1/routes/{route_id}/comments", get(list_comments))
        .route("/api/v1/routes/{route_id}/comments/count", get(count_comments))
        .route("/api/v1/routes/{route_id}/like", get(get_like_count))
        .route("/api/v1/routes/{route_id}/rating", get(get_rating_aggregate))
        .route("/api/v1/settings/difficulty", get(get_difficulty_thresholds))
        .route("/api/v1/categories", get(list_categories))
        .route("/api/v1/chat/health", get(chat_health))
        .merge(routes_api)
        .layer(TraceLayer::new_for_http())
        .with_state(shared_state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    tracing::info!("routes service running on 0.0.0.0:8080");
    axum::serve(listener, router).await?;

    // Shutdown telemetry on exit
    if config.telemetry_enabled {
        telemetry::shutdown_telemetry();
    }

    Ok(())
}

async fn metrics(State(state): State<Arc<AppState>>) -> String {
    metrics_process::Collector::default().collect();
    state.metrics_handle.render()
}

#[tracing::instrument]
async fn healthz() -> &'static str {
    "OK"
}
