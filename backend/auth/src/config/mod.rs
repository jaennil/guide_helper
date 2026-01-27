use config::{Config, Environment};
use serde::Deserialize;

#[derive(Deserialize, Debug)]
pub struct AppConfig {
    pub database_url: String,
    pub database_max_connections: u32,
    pub jwt_secret: String,
    pub jwt_access_token_minutes: i64,
    pub jwt_refresh_token_days: i64,
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
}

fn default_telemetry_service_name() -> String {
    "guide-helper-auth".to_string()
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

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            database_url: String::new(),
            database_max_connections: 5,
            jwt_secret: "change_this_secret_key_in_production".to_string(),
            jwt_access_token_minutes: 15,
            jwt_refresh_token_days: 7,
            telemetry_enabled: false,
            telemetry_service_name: default_telemetry_service_name(),
            telemetry_service_version: default_telemetry_service_version(),
            telemetry_environment: default_telemetry_environment(),
            telemetry_otlp_endpoint: default_telemetry_otlp_endpoint(),
        }
    }
}

impl AppConfig {
    pub fn from_env() -> Self {
        let settings = Config::builder()
            .add_source(Environment::default())
            .build()
            .unwrap();

        settings.try_deserialize().unwrap_or_else(|_| Self::default())
    }
}
