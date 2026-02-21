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
    #[serde(default)]
    pub openai_api_key: Option<String>,
    #[serde(default = "default_openai_base_url")]
    pub openai_base_url: String,
    #[serde(default = "default_openai_model")]
    pub openai_model: String,
    #[serde(default = "default_chat_rate_limit_max")]
    pub chat_rate_limit_max: u32,
    #[serde(default = "default_chat_rate_limit_window_secs")]
    pub chat_rate_limit_window_secs: u64,
    #[serde(default = "default_chat_max_tool_iterations")]
    pub chat_max_tool_iterations: usize,
    #[serde(default = "default_nominatim_url")]
    pub nominatim_url: String,
    #[serde(default = "default_chat_max_message_length")]
    pub chat_max_message_length: usize,
}

fn default_nats_url() -> String {
    "nats://localhost:4222".to_string()
}

fn default_openai_base_url() -> String {
    "https://api.openai.com/v1".to_string()
}

fn default_openai_model() -> String {
    "gpt-4o-mini".to_string()
}

fn default_chat_rate_limit_max() -> u32 {
    10
}

fn default_chat_rate_limit_window_secs() -> u64 {
    60
}

fn default_chat_max_tool_iterations() -> usize {
    5
}

fn default_nominatim_url() -> String {
    "https://nominatim.openstreetmap.org".to_string()
}

fn default_chat_max_message_length() -> usize {
    2000
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
    pub fn from_env() -> Result<Self, config::ConfigError> {
        Config::builder()
            .set_default("database_max_connections", 5)?
            .add_source(Environment::default())
            .build()?
            .try_deserialize()
    }
}
