use config::{Config, Environment};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct AppConfig {
    pub database_url: String,
    pub database_max_connections: u32,
    pub jwt_secret: String,
    #[serde(default)]
    pub telemetry_enabled: bool,
    #[serde(default = "default_telemetry_service_name")]
    pub telemetry_service_name: String,
    #[serde(default = "default_telemetry_service_version")]
    pub telemetry_service_version: String,
    #[serde(default = "default_telemetry_environment")]
    pub telemetry_environment: String,
    #[serde(default = "default_telemetry_otlp_endpoint")]
    pub telemetry_otlp_endpoint: String,
    #[serde(default = "default_nats_url")]
    pub nats_url: String,
    #[serde(default = "default_ollama_url")]
    pub ollama_url: String,
    #[serde(default = "default_ollama_model")]
    pub ollama_model: String,
}

fn default_nats_url() -> String {
    "nats://localhost:4222".to_string()
}

fn default_ollama_url() -> String {
    "http://ollama:11434".to_string()
}

fn default_ollama_model() -> String {
    "llama3.2".to_string()
}

fn default_telemetry_service_name() -> String {
    "guide-helper-routes".to_string()
}

fn default_telemetry_service_version() -> String {
    "1.0.0".to_string()
}

fn default_telemetry_environment() -> String {
    "production".to_string()
}

fn default_telemetry_otlp_endpoint() -> String {
    "http://otel-collector.observability.svc.cluster.local:4317".to_string()
}

impl AppConfig {
    pub fn from_env() -> Self {
        Config::builder()
            .set_default("database_max_connections", 5)
            .unwrap()
            .add_source(Environment::default())
            .build()
            .unwrap()
            .try_deserialize()
            .unwrap()
    }
}
