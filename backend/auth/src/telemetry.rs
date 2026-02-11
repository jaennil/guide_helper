use opentelemetry::trace::TracerProvider;
use opentelemetry::KeyValue;
use opentelemetry_otlp::{SpanExporter, WithExportConfig};
use opentelemetry_sdk::{trace as sdktrace, Resource};
use opentelemetry_semantic_conventions::resource::{SERVICE_NAME, SERVICE_VERSION};
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{fmt, EnvFilter};

pub struct TelemetryConfig {
    pub service_name: String,
    pub service_version: String,
    pub environment: String,
    pub otlp_endpoint: String,
}

impl Default for TelemetryConfig {
    fn default() -> Self {
        Self {
            service_name: "guide-helper-auth".to_string(),
            service_version: "1.0.0".to_string(),
            environment: "production".to_string(),
            otlp_endpoint: "http://otel-collector.observability.svc.cluster.local:4317".to_string(),
        }
    }
}

pub fn init_telemetry_with_subscriber(
    config: &TelemetryConfig,
    env_filter: EnvFilter,
) -> Result<(), Box<dyn std::error::Error>> {
    let resource = Resource::builder_empty()
        .with_attribute(KeyValue::new(SERVICE_NAME, config.service_name.clone()))
        .with_attribute(KeyValue::new(SERVICE_VERSION, config.service_version.clone()))
        .with_attribute(KeyValue::new(
            "deployment.environment.name",
            config.environment.clone(),
        ))
        .build();

    let exporter = SpanExporter::builder()
        .with_tonic()
        .with_endpoint(&config.otlp_endpoint)
        .build()?;

    let provider = sdktrace::SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(resource)
        .build();

    let tracer = provider.tracer(config.service_name.clone());

    opentelemetry::global::set_tracer_provider(provider);

    let otel_layer = OpenTelemetryLayer::new(tracer);

    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer().json())
        .with(otel_layer)
        .init();

    tracing::info!(
        "OpenTelemetry initialized: service={}, endpoint={}",
        config.service_name,
        config.otlp_endpoint
    );

    Ok(())
}

pub fn init_subscriber_without_telemetry(env_filter: EnvFilter) {
    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer().json())
        .init();
}

pub fn shutdown_telemetry() {
    // In opentelemetry 0.28, there is no shutdown_tracer_provider
    // The tracer provider is dropped when it goes out of scope
    tracing::info!("OpenTelemetry tracer provider shutdown");
}
