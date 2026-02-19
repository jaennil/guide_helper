use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::Validate;

use crate::delivery::http::v1::middleware::AuthenticatedUser;
use crate::usecase::contracts::RouteRepository;
use crate::usecase::error::UsecaseError;
use crate::AppState;

#[derive(Deserialize, Validate)]
pub struct SetRatingRequest {
    #[validate(range(min = 1, max = 5))]
    pub rating: i16,
}

#[derive(Serialize)]
pub struct RatingAggregateResponse {
    pub average: f64,
    pub count: i64,
}

#[derive(Serialize)]
pub struct UserRatingResponse {
    pub rating: Option<i16>,
}

#[derive(Serialize)]
pub struct SetRatingResponse {
    pub average: f64,
    pub count: i64,
    pub user_rating: i16,
}

#[tracing::instrument(skip(state, payload), fields(user_id = %user.user_id, route_id = %route_id))]
pub async fn set_rating(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(route_id): Path<Uuid>,
    Json(payload): Json<SetRatingRequest>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!("handling set rating request");

    if let Err(validation_errors) = payload.validate() {
        tracing::warn!(user_id = %user.user_id, ?validation_errors, "validation failed");
        return Err(UsecaseError::Validation(format!("{:?}", validation_errors)));
    }

    state
        .ratings_usecase
        .set_rating(route_id, user.user_id, payload.rating)
        .await?;

    let info = state
        .ratings_usecase
        .get_rating_info(route_id, Some(user.user_id))
        .await?;

    // Emit notification to route owner (best-effort)
    if let Ok(Some(route)) = state.routes_usecase.route_repository().find_by_id(route_id).await {
        if route.user_id != user.user_id {
            let msg = format!("{} rated your route \"{}\" with {}/5", &user.email, &route.name, payload.rating);
            if let Err(e) = state.notifications_usecase.create_notification(
                route.user_id,
                "rating".to_string(),
                route_id,
                user.email.clone(),
                msg,
            ).await {
                tracing::error!(error = %e, "failed to create rating notification");
            }
        }
    }

    tracing::debug!(route_id = %route_id, average = info.average, count = info.count, "rating set successfully");
    Ok((
        StatusCode::OK,
        Json(SetRatingResponse {
            average: info.average,
            count: info.count,
            user_rating: payload.rating,
        }),
    ))
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id, route_id = %route_id))]
pub async fn remove_rating(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!("handling remove rating request");

    state
        .ratings_usecase
        .remove_rating(route_id, user.user_id)
        .await?;

    tracing::debug!(route_id = %route_id, "rating removed successfully");
    Ok(StatusCode::NO_CONTENT)
}

#[tracing::instrument(skip(state), fields(route_id = %route_id))]
pub async fn get_rating_aggregate(
    State(state): State<Arc<AppState>>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!("handling get rating aggregate request");

    let info = state.ratings_usecase.get_rating_info(route_id, None).await?;

    tracing::debug!(route_id = %route_id, average = info.average, count = info.count, "rating aggregate retrieved");
    Ok((
        StatusCode::OK,
        Json(RatingAggregateResponse {
            average: info.average,
            count: info.count,
        }),
    ))
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id, route_id = %route_id))]
pub async fn get_user_rating(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!("handling get user rating request");

    let info = state
        .ratings_usecase
        .get_rating_info(route_id, Some(user.user_id))
        .await?;

    tracing::debug!(route_id = %route_id, ?info.user_rating, "user rating retrieved");
    Ok((
        StatusCode::OK,
        Json(UserRatingResponse {
            rating: info.user_rating,
        }),
    ))
}
