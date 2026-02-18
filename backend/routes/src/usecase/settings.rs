use serde::{Deserialize, Serialize};

use crate::repository::errors::RepositoryError;
use crate::usecase::contracts::SettingsRepository;

const DIFFICULTY_THRESHOLDS_KEY: &str = "difficulty_thresholds";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DifficultyThresholds {
    pub distance_easy_max_km: f64,
    pub distance_moderate_max_km: f64,
    pub elevation_easy_max_m: f64,
    pub elevation_moderate_max_m: f64,
    pub score_easy_max: i32,
    pub score_moderate_max: i32,
}

impl Default for DifficultyThresholds {
    fn default() -> Self {
        Self {
            distance_easy_max_km: 5.0,
            distance_moderate_max_km: 15.0,
            elevation_easy_max_m: 300.0,
            elevation_moderate_max_m: 800.0,
            score_easy_max: 3,
            score_moderate_max: 4,
        }
    }
}

pub struct SettingsUseCase<R: SettingsRepository> {
    settings_repository: R,
}

impl<R: SettingsRepository> SettingsUseCase<R> {
    pub fn new(settings_repository: R) -> Self {
        Self { settings_repository }
    }

    pub fn settings_repository(&self) -> &R {
        &self.settings_repository
    }

    #[tracing::instrument(skip(self))]
    pub async fn get_difficulty_thresholds(&self) -> Result<DifficultyThresholds, RepositoryError> {
        tracing::debug!("getting difficulty thresholds");

        let value = self.settings_repository.get_value(DIFFICULTY_THRESHOLDS_KEY).await?;

        match value {
            Some(v) => {
                let thresholds: DifficultyThresholds = serde_json::from_value(v)
                    .map_err(|e| RepositoryError::DatabaseError(format!("failed to deserialize difficulty thresholds: {}", e)))?;
                tracing::debug!(?thresholds, "difficulty thresholds loaded");
                Ok(thresholds)
            }
            None => {
                tracing::info!("no difficulty thresholds found, returning defaults");
                Ok(DifficultyThresholds::default())
            }
        }
    }

    #[tracing::instrument(skip(self))]
    pub async fn set_difficulty_thresholds(&self, thresholds: &DifficultyThresholds) -> Result<(), RepositoryError> {
        tracing::debug!(?thresholds, "saving difficulty thresholds");

        let value = serde_json::to_value(thresholds)
            .map_err(|e| RepositoryError::DatabaseError(format!("failed to serialize difficulty thresholds: {}", e)))?;

        self.settings_repository.set_value(DIFFICULTY_THRESHOLDS_KEY, &value).await?;

        tracing::info!("difficulty thresholds saved");
        Ok(())
    }
}
