mod config;
mod delivery;
mod domain;
mod repository;
mod usecase;

use std::sync::Arc;

use axum::{
    extract::State,
    middleware,
    routing::get,
    Router,
};
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};
use tracing_subscriber::{fmt, layer::SubscriberExt, EnvFilter};

use crate::delivery::http::v1::middleware::auth_middleware;
use crate::delivery::http::v1::routes::{create_route, delete_route, get_route, list_routes, update_route};
use crate::repository::postgres::{create_pool, PostgresRouteRepository};
use crate::usecase::jwt::JwtService;
use crate::usecase::routes::RoutesUseCase;

pub struct AppState {
    pub routes_usecase: RoutesUseCase<PostgresRouteRepository>,
    pub jwt_service: JwtService,
    pub metrics_handle: PrometheusHandle,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    let subscriber = tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer());

    tracing::subscriber::set_global_default(subscriber)?;
    tracing::info!("starting the routes service");

    let metrics_handle = PrometheusBuilder::new()
        .install_recorder()
        .expect("failed to install Prometheus recorder");
    metrics_process::Collector::default().describe();
    tracing::info!("prometheus metrics initialized");

    let config = config::AppConfig::from_env();
    tracing::info!("config loaded");

    let pool = create_pool(&config.database_url, config.database_max_connections)
        .await
        .expect("failed to create database pool");
    tracing::info!("database pool created");

    sqlx::migrate!().run(&pool).await?;
    tracing::info!("database migrations applied");

    let route_repository = PostgresRouteRepository::new(pool);
    let jwt_service = JwtService::new(config.jwt_secret);
    let routes_usecase = RoutesUseCase::new(route_repository);

    let shared_state = Arc::new(AppState {
        routes_usecase,
        jwt_service,
        metrics_handle,
    });

    // All routes require authentication
    let routes_api = Router::new()
        .route("/api/v1/routes", get(list_routes).post(create_route))
        .route(
            "/api/v1/routes/{id}",
            get(get_route).put(update_route).delete(delete_route),
        )
        .layer(middleware::from_fn_with_state(
            shared_state.clone(),
            auth_middleware,
        ));

    let router = Router::new()
        .route("/healthz", get(|| async { "OK" }))
        .route("/metrics", get(metrics))
        .merge(routes_api)
        .with_state(shared_state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    tracing::info!("routes service running on 0.0.0.0:8080");
    axum::serve(listener, router).await?;

    Ok(())
}

async fn metrics(State(state): State<Arc<AppState>>) -> String {
    metrics_process::Collector::default().collect();
    state.metrics_handle.render()
}
