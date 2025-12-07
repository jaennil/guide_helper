mod domain;
mod config;
mod delivery;
mod usecase;
mod repository;

use std::sync::Arc;

use axum::{routing::{get, post}, Router};
use tracing_subscriber::{fmt, layer::SubscriberExt};
use crate::delivery::http::v1::auth::{register, login, refresh_token};

use crate::{repository::postgres::{create_pool, PostgresUserRepository}, usecase::auth::AuthUseCase, usecase::jwt::JwtService};

struct AppState {
    auth_usecase: AuthUseCase<PostgresUserRepository>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let subscriber = tracing_subscriber::registry()
        .with(fmt::layer());

    tracing::subscriber::set_global_default(subscriber)?;
    tracing::info!("starting the app");

    let config = config::AppConfig::from_env();
    tracing::debug!(?config, "config");

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

    let shared_state = Arc::new(AppState{auth_usecase});
    let router = Router::new()
        // .merge(SwaggerUi::new("/docs").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .route("/healthz", get(|| async { "OK" }))
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/refresh", post(refresh_token))
        .with_state(shared_state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    tracing::info!("server running on 0.0.0.0:8080");
    axum::serve(listener, router).await?;

    Ok(())
}
