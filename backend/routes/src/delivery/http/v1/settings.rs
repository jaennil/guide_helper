use std::sync::Arc;

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};

use crate::delivery::http::v1::admin::require_admin;
use crate::delivery::http::v1::middleware::AuthenticatedUser;
use crate::usecase::error::UsecaseError;
use crate::usecase::settings::DifficultyThresholds;
use crate::AppState;

#[tracing::instrument(skip(state))]
pub async fn get_difficulty_thresholds(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!("getting difficulty thresholds");

    let thresholds = state.settings_usecase.get_difficulty_thresholds().await
        .map_err(|e| UsecaseError::Internal(e.to_string()))?;

    tracing::debug!("difficulty thresholds retrieved");
    Ok((StatusCode::OK, Json(thresholds)))
}

#[tracing::instrument(skip(state, body), fields(user_id = %user.user_id))]
pub async fn set_difficulty_thresholds(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(body): Json<DifficultyThresholds>,
) -> Result<impl IntoResponse, UsecaseError> {
    require_admin(&user)?;

    tracing::debug!(?body, "setting difficulty thresholds");

    if body.distance_easy_max_km <= 0.0
        || body.distance_moderate_max_km <= 0.0
        || body.elevation_easy_max_m <= 0.0
        || body.elevation_moderate_max_m <= 0.0
        || body.score_easy_max <= 0
        || body.score_moderate_max <= 0
    {
        tracing::warn!("invalid thresholds: all values must be positive");
        return Err(UsecaseError::Validation("All threshold values must be positive".to_string()));
    }

    if body.distance_easy_max_km >= body.distance_moderate_max_km {
        tracing::warn!(
            easy = body.distance_easy_max_km,
            moderate = body.distance_moderate_max_km,
            "invalid thresholds: easy distance must be less than moderate"
        );
        return Err(UsecaseError::Validation("Easy distance threshold must be less than moderate".to_string()));
    }

    if body.elevation_easy_max_m >= body.elevation_moderate_max_m {
        tracing::warn!(
            easy = body.elevation_easy_max_m,
            moderate = body.elevation_moderate_max_m,
            "invalid thresholds: easy elevation must be less than moderate"
        );
        return Err(UsecaseError::Validation("Easy elevation threshold must be less than moderate".to_string()));
    }

    if body.score_easy_max >= body.score_moderate_max {
        tracing::warn!(
            easy = body.score_easy_max,
            moderate = body.score_moderate_max,
            "invalid thresholds: easy score must be less than moderate"
        );
        return Err(UsecaseError::Validation("Easy score threshold must be less than moderate".to_string()));
    }

    state.settings_usecase.set_difficulty_thresholds(&body).await
        .map_err(|e| UsecaseError::Internal(e.to_string()))?;

    tracing::info!(user_id = %user.user_id, "difficulty thresholds updated by admin");
    Ok((StatusCode::OK, Json(body)))
}
