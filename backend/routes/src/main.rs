mod config;
mod delivery;
mod domain;
mod repository;
mod telemetry;
mod usecase;

use std::sync::Arc;

use axum::{
    extract::State,
    middleware,
    routing::{get, post},
    Router,
};
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use crate::delivery::http::v1::middleware::auth_middleware;
use crate::delivery::http::v1::routes::{create_route, delete_route, get_route, import_route_from_geojson, list_routes, update_route};
use crate::repository::postgres::{create_pool, PostgresRouteRepository};
use crate::usecase::jwt::JwtService;
use crate::usecase::routes::RoutesUseCase;

pub struct AppState {
    pub routes_usecase: RoutesUseCase<PostgresRouteRepository>,
    pub jwt_service: JwtService,
    pub metrics_handle: PrometheusHandle,
    pub nats_client: Option<async_nats::Client>,
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

    let route_repository = PostgresRouteRepository::new(pool);
    let jwt_service = JwtService::new(config.jwt_secret);
    let routes_usecase = RoutesUseCase::new(route_repository);

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

    let shared_state = Arc::new(AppState {
        routes_usecase,
        jwt_service,
        metrics_handle,
        nats_client,
    });

    // All routes require authentication
    let routes_api = Router::new()
        .route("/api/v1/routes", get(list_routes).post(create_route))
        .route("/api/v1/routes/import", post(import_route_from_geojson))
        .route(
            "/api/v1/routes/{id}",
            get(get_route).put(update_route).delete(delete_route),
        )
        .layer(middleware::from_fn_with_state(
            shared_state.clone(),
            auth_middleware,
        ));

    let router = Router::new()
        .route("/healthz", get(healthz))
        .route("/metrics", get(metrics))
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
