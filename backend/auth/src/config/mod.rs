use config::{Config, Environment};
use serde::Deserialize;

#[derive(Deserialize, Debug)]
pub struct AppConfig {
    pub database_url: String,
    pub database_max_connections: u32,
    pub jwt_secret: String,
    pub jwt_access_token_minutes: i64,
    pub jwt_refresh_token_days: i64,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            database_url: String::new(),
            database_max_connections: 5,
            jwt_secret: "change_this_secret_key_in_production".to_string(),
            jwt_access_token_minutes: 15,
            jwt_refresh_token_days: 7,
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
