mod domain;
mod config;
mod delivery;
mod usecase;
mod repository;

use axum::{routing::{get, post}, Router};
use tracing_subscriber::{fmt, layer::SubscriberExt};

use crate::repository::postgres::{create_pool, PostgresUserRepository};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let subscriber = tracing_subscriber::registry()
        .with(fmt::layer());

    tracing::subscriber::set_global_default(subscriber)?;

    let config = config::AppConfig::from_env();
    tracing::debug!(?config, "config");

    let pool = create_pool(&config.database_url, config.database_max_connections)
        .await
        .expect("failed to create database pool")

    let user_repository = PostgresUserRepository::new(pool);
    let auth_use_case = AuthUseCase::new(user_repository);

    let router = Router::new()
        // .merge(SwaggerUi::new("/docs").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .route("/healthz", get(|| async { "OK" }))
        .route("/api/v1/auth/register", post(delivery::http::v1::auth::register));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8080").await?;
    tracing::info!("server running on 127.0.0.1:8080");
    axum::serve(listener, router).await?;

    Ok(())
}
