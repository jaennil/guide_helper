mod domain;
mod config;
mod delivery;
mod usecase;
mod repository;
mod telemetry;

use std::sync::Arc;

use axum::{extract::State, routing::{get, post}, Router};
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};
use tower_http::trace::TraceLayer;
use crate::delivery::http::v1::auth::{register, login, refresh_token};

use crate::{repository::postgres::{create_pool, PostgresUserRepository}, usecase::auth::AuthUseCase, usecase::jwt::JwtService};

struct AppState {
    auth_usecase: AuthUseCase<PostgresUserRepository>,
    metrics_handle: PrometheusHandle,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = config::AppConfig::from_env();

    // Initialize telemetry if enabled
    if config.telemetry.enabled {
        telemetry::init_telemetry(&config.telemetry)?;
    } else {
        // Fall back to simple tracing if telemetry is disabled
        let subscriber = tracing_subscriber::registry()
            .with(tracing_subscriber::fmt::layer());
        tracing::subscriber::set_global_default(subscriber)?;
    }

    tracing::info!("starting the app");

    tracing::debug!(?config, "config");

    let metrics_handle = PrometheusBuilder::new()
        .install_recorder()
        .expect("failed to install Prometheus recorder");
    metrics_process::Collector::default().describe();
    tracing::info!("prometheus metrics initialized");

    let pool = create_pool(&config.database_url, config.database_max_connections)
        .await
        .expect("failed to create database pool");

    sqlx::migrate!().run(&pool).await?;

    let user_repository = PostgresUserRepository::new(pool);

    // Create JWT service with configuration
    let jwt_service = JwtService::new(
        config.jwt_secret.clone(),
        config.jwt_access_token_minutes,
        config.jwt_refresh_token_days,
    );

    let auth_usecase = AuthUseCase::with_jwt_service(user_repository, jwt_service);

    let shared_state = Arc::new(AppState{auth_usecase, metrics_handle});
    let mut router = Router::new()
        // .merge(SwaggerUi::new("/docs").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .route("/healthz", get(|| async { "OK" }))
        .route("/metrics", get(metrics))
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/refresh", post(refresh_token))
        .with_state(shared_state);

    // Add tracing layer if telemetry is enabled
    if config.telemetry.enabled {
        router = router.layer(TraceLayer::new_for_http());
    }

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    tracing::info!("server running on 0.0.0.0:8080");
    axum::serve(listener, router).await?;

    // Shutdown telemetry if it was enabled
    if config.telemetry.enabled {
        telemetry::shutdown_telemetry().await;
    }

    Ok(())
}

async fn metrics(State(state): State<Arc<AppState>>) -> String {
    metrics_process::Collector::default().collect();
    state.metrics_handle.render()
}
