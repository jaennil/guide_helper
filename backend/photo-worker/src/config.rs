use config::{Config, Environment};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct AppConfig {
    pub database_url: String,
    #[serde(default = "default_database_max_connections")]
    pub database_max_connections: u32,
    #[serde(default = "default_nats_url")]
    pub nats_url: String,
    #[serde(default = "default_minio_endpoint")]
    pub minio_endpoint: String,
    #[serde(default = "default_minio_access_key")]
    pub minio_access_key: String,
    #[serde(default = "default_minio_secret_key")]
    pub minio_secret_key: String,
    #[serde(default = "default_minio_bucket")]
    pub minio_bucket: String,
    #[serde(default = "default_photo_max_width")]
    pub photo_max_width: u32,
    #[serde(default = "default_photo_quality")]
    pub photo_quality: u8,
    #[serde(default = "default_thumbnail_width")]
    pub thumbnail_width: u32,
    #[serde(default = "default_photo_base_url")]
    pub photo_base_url: String,
}

fn default_database_max_connections() -> u32 {
    5
}

fn default_nats_url() -> String {
    "nats://localhost:4222".to_string()
}

fn default_minio_endpoint() -> String {
    "http://minio:9000".to_string()
}

fn default_minio_access_key() -> String {
    "minioadmin".to_string()
}

fn default_minio_secret_key() -> String {
    "minioadmin".to_string()
}

fn default_minio_bucket() -> String {
    "photos".to_string()
}

fn default_photo_max_width() -> u32 {
    1920
}

fn default_photo_quality() -> u8 {
    85
}

fn default_thumbnail_width() -> u32 {
    300
}

fn default_photo_base_url() -> String {
    "/photos".to_string()
}

impl AppConfig {
    pub fn from_env() -> Self {
        Config::builder()
            .add_source(Environment::default())
            .build()
            .unwrap()
            .try_deserialize()
            .unwrap()
    }
}
