mod domain;
mod config;
mod delivery;
mod usecase;
mod repository;

use std::sync::Arc;

use axum::{extract::State, middleware, routing::{get, post, put}, Router};
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};
use tracing_subscriber::{fmt, layer::SubscriberExt, EnvFilter};
use crate::delivery::http::v1::auth::{register, login, refresh_token};
use crate::delivery::http::v1::middleware::auth_middleware;
use crate::delivery::http::v1::profile::{get_profile, update_profile, change_password};

use crate::{repository::postgres::{create_pool, PostgresUserRepository}, usecase::auth::AuthUseCase, usecase::jwt::JwtService};

pub struct AppState {
    pub auth_usecase: AuthUseCase<PostgresUserRepository>,
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
    tracing::info!("starting the auth service");

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

    sqlx::migrate!().run(&pool).await?;

    let user_repository = PostgresUserRepository::new(pool);

    // Create JWT service with configuration
    let jwt_service = JwtService::new(
        config.jwt_secret.clone(),
        config.jwt_access_token_minutes,
        config.jwt_refresh_token_days,
    );

    let auth_usecase = AuthUseCase::with_jwt_service(user_repository, jwt_service.clone());

    let shared_state = Arc::new(AppState{auth_usecase, jwt_service, metrics_handle});
    // Protected routes that require authentication
    let protected_routes = Router::new()
        .route("/api/v1/auth/me", get(get_profile).put(update_profile))
        .route("/api/v1/auth/password", put(change_password))
        .layer(middleware::from_fn_with_state(shared_state.clone(), auth_middleware));

    let router = Router::new()
        // .merge(SwaggerUi::new("/docs").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .route("/healthz", get(|| async { "OK" }))
        .route("/metrics", get(metrics))
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/refresh", post(refresh_token))
        .merge(protected_routes)
        .with_state(shared_state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    tracing::info!("server running on 0.0.0.0:8080");
    axum::serve(listener, router).await?;

    Ok(())
}

async fn metrics(State(state): State<Arc<AppState>>) -> String {
    metrics_process::Collector::default().collect();
    state.metrics_handle.render()
}
