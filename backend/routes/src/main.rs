#![allow(async_fn_in_trait)]

mod app;
mod config;
mod delivery;
mod domain;
mod repository;
mod telemetry;
mod usecase;

pub use app::state::AppState;

use metrics_exporter_prometheus::PrometheusBuilder;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config =
        config::AppConfig::from_env().expect("failed to load configuration from environment");

    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

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

    tracing::info!(
        "config loaded, telemetry_enabled={}",
        config.telemetry_enabled
    );

    let shared_state = app::bootstrap::build_app_state(&config, metrics_handle).await?;

    app::background::spawn_rate_limiter_cleanup(&shared_state);
    app::background::spawn_photo_completion_subscriber(
        shared_state.nats_client.clone(),
        shared_state.ws_channels.clone(),
    );

    let router = app::router::build_router(shared_state);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    tracing::info!("routes service running on 0.0.0.0:8080");
    axum::serve(listener, router).await?;

    if config.telemetry_enabled {
        telemetry::shutdown_telemetry();
    }

    Ok(())
}
