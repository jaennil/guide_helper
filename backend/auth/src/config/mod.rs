use config::Config;
use serde::Deserialize;

#[derive(Deserialize, Debug)]
pub struct AppConfig {
    pub database_url: String,
    pub database_max_connections: u32,
}

impl AppConfig {
    pub fn from_env() -> Self {
        let settings = Config::builder()
            .add_source(config::Environment::with_prefix("APP"))
            .build()
            .unwrap();

        settings.try_deserialize().unwrap()
    }
}
