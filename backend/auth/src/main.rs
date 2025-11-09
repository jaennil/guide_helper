mod domain;
mod config;
mod delivery;
mod usecase;
mod repository;

use std::sync::Arc;

use axum::{routing::{get, post}, Router};
use tracing_subscriber::{fmt, layer::SubscriberExt};
use crate::delivery::{http::v1::auth::register};

use crate::{repository::postgres::{create_pool, PostgresUserRepository}, usecase::auth::AuthUseCase};

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
    let auth_usecase = AuthUseCase::new(user_repository);

    let shared_state = Arc::new(AppState{auth_usecase});
    let router = Router::new()
        // .merge(SwaggerUi::new("/docs").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .route("/healthz", get(|| async { "OK" }))
        .route("/api/v1/auth/register", post(register))
        .with_state(shared_state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8080").await?;
    tracing::info!("server running on 127.0.0.1:8080");
    axum::serve(listener, router).await?;

    Ok(())
}
