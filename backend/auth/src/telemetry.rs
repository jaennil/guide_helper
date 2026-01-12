use anyhow::Result;
use opentelemetry::{global, KeyValue};
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::{propagation::TraceContextPropagator, trace::{self, TracerProvider}, Resource};
use tracing_subscriber::{layer::SubscriberExt, Registry};
use crate::config::TelemetryConfig;

pub fn init_telemetry(config: &TelemetryConfig) -> Result<()> {
    // Set up trace context propagator
    global::set_text_map_propagator(TraceContextPropagator::new());

    // Create OTLP exporter
    let otlp_exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(&config.otlp_endpoint)
        .build()?;

    // Create resource with service information
    let resource = Resource::new(vec![
        KeyValue::new("service.name", config.service_name.clone()),
        KeyValue::new("service.version", config.service_version.clone()),
        KeyValue::new("deployment.environment", config.environment.clone()),
    ]);

    // Create tracer provider
    let tracer_provider = TracerProvider::builder()
        .with_batch_exporter(otlp_exporter, opentelemetry_sdk::runtime::Tokio)
        .with_resource(resource)
        .build();

    // Set global tracer provider
    global::set_tracer_provider(tracer_provider.clone());

    // Create tracing layer with OpenTelemetry
    let telemetry_layer = tracing_opentelemetry::layer()
        .with_tracer(tracer_provider.tracer(config.service_name.clone()));

    // Create subscriber with telemetry layer
    let subscriber = Registry::default()
        .with(tracing_subscriber::fmt::layer())
        .with(telemetry_layer);

    tracing::subscriber::set_global_default(subscriber)?;

    tracing::info!(
        service_name = %config.service_name,
        otlp_endpoint = %config.otlp_endpoint,
        "OpenTelemetry initialized"
    );

    Ok(())
}

pub async fn shutdown_telemetry() {
    global::shutdown_tracer_provider();
    tracing::info!("OpenTelemetry shutdown completed");
}
