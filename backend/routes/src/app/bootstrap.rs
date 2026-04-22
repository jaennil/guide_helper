use std::collections::HashMap;
use std::sync::Arc;

use metrics_exporter_prometheus::PrometheusHandle;
use tokio::sync::{RwLock, broadcast};
use uuid::Uuid;

use crate::app::ai::{build_chat_usecase, build_routes_usecase};
use crate::app::state::AppState;
use crate::config::AppConfig;
use crate::repository::postgres::{
    PostgresBookmarkRepository, PostgresCategoryRepository, PostgresChatMessageRepository,
    PostgresCommentRepository, PostgresLikeRepository, PostgresNotificationRepository,
    PostgresRatingRepository, PostgresRouteRepository, PostgresSettingsRepository, create_pool,
};
use crate::usecase::bookmarks::BookmarksUseCase;
use crate::usecase::categories::CategoriesUseCase;
use crate::usecase::comments::CommentsUseCase;
use crate::usecase::jwt::JwtService;
use crate::usecase::likes::LikesUseCase;
use crate::usecase::notifications::NotificationsUseCase;
use crate::usecase::ratings::RatingsUseCase;
use crate::usecase::settings::SettingsUseCase;

pub async fn build_app_state(
    config: &AppConfig,
    metrics_handle: PrometheusHandle,
) -> anyhow::Result<Arc<AppState>> {
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
    let bookmark_repository = PostgresBookmarkRepository::new(pool.clone());
    let route_repository_for_bookmarks = PostgresRouteRepository::new(pool.clone());
    let settings_repository = PostgresSettingsRepository::new(pool.clone());
    let category_repository = PostgresCategoryRepository::new(pool.clone());
    let notification_repository = PostgresNotificationRepository::new(pool.clone());
    let chat_message_repository = PostgresChatMessageRepository::new(pool.clone());
    let route_repository_for_chat = PostgresRouteRepository::new(pool);

    let routes_usecase = build_routes_usecase(config, route_repository);
    let comments_usecase = CommentsUseCase::new(comment_repository, route_repository_for_comments);
    let likes_usecase = LikesUseCase::new(like_repository, route_repository_for_likes);
    let ratings_usecase = RatingsUseCase::new(rating_repository, route_repository_for_ratings);
    let bookmarks_usecase =
        BookmarksUseCase::new(bookmark_repository, route_repository_for_bookmarks);
    let settings_usecase = SettingsUseCase::new(settings_repository);
    let categories_usecase = CategoriesUseCase::new(category_repository);
    let notifications_usecase = NotificationsUseCase::new(notification_repository);
    let chat_usecase =
        build_chat_usecase(config, chat_message_repository, route_repository_for_chat);
    tracing::info!("ChatUseCase initialized");

    let nats_client = connect_nats(&config.nats_url).await;
    let jwt_service = JwtService::new(config.jwt_secret.clone());
    let ws_channels: Arc<RwLock<HashMap<Uuid, broadcast::Sender<String>>>> =
        Arc::new(RwLock::new(HashMap::new()));
    let chat_rate_limits: Arc<RwLock<HashMap<Uuid, (std::time::Instant, u32)>>> =
        Arc::new(RwLock::new(HashMap::new()));

    Ok(Arc::new(AppState {
        routes_usecase,
        comments_usecase,
        likes_usecase,
        ratings_usecase,
        bookmarks_usecase,
        settings_usecase,
        categories_usecase,
        notifications_usecase,
        chat_usecase,
        jwt_service,
        metrics_handle,
        nats_client,
        ws_channels,
        chat_rate_limits,
        chat_rate_limit_max: config.chat_rate_limit_max,
        chat_rate_limit_window_secs: config.chat_rate_limit_window_secs,
    }))
}

async fn connect_nats(nats_url: &str) -> Option<async_nats::Client> {
    match async_nats::connect(nats_url).await {
        Ok(client) => {
            tracing::info!(nats_url = %nats_url, "connected to NATS");

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
            tracing::warn!(error = %e, nats_url = %nats_url, "failed to connect to NATS, photo processing will be unavailable");
            None
        }
    }
}
