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
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!("handling set rating request");

    if let Err(validation_errors) = payload.validate() {
        tracing::warn!(user_id = %user.user_id, ?validation_errors, "validation failed");
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Validation error: {:?}", validation_errors),
        ));
    }

    if let Err(e) = state
        .ratings_usecase
        .set_rating(route_id, user.user_id, payload.rating)
        .await
    {
        let error_msg = e.to_string();
        if error_msg.contains("not found") {
            tracing::warn!(route_id = %route_id, "route not found for rating");
            return Err((StatusCode::NOT_FOUND, "Route not found".to_string()));
        }
        if error_msg.contains("between 1 and 5") {
            tracing::warn!(route_id = %route_id, "invalid rating value");
            return Err((StatusCode::BAD_REQUEST, error_msg));
        }
        tracing::error!(route_id = %route_id, error = %e, "failed to set rating");
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to set rating: {}", e),
        ));
    }

    let info = state
        .ratings_usecase
        .get_rating_info(route_id, Some(user.user_id))
        .await
        .map_err(|e| {
            tracing::error!(route_id = %route_id, error = %e, "failed to get rating info after set");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get rating info: {}", e),
            )
        })?;

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
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!("handling remove rating request");

    match state
        .ratings_usecase
        .remove_rating(route_id, user.user_id)
        .await
    {
        Ok(()) => {
            tracing::debug!(route_id = %route_id, "rating removed successfully");
            Ok(StatusCode::NO_CONTENT)
        }
        Err(e) => {
            let error_msg = e.to_string();
            if error_msg.contains("Not found") {
                tracing::warn!(route_id = %route_id, "rating not found");
                Err((StatusCode::NOT_FOUND, "Rating not found".to_string()))
            } else {
                tracing::error!(route_id = %route_id, error = %e, "failed to remove rating");
                Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to remove rating: {}", e),
                ))
            }
        }
    }
}

#[tracing::instrument(skip(state), fields(route_id = %route_id))]
pub async fn get_rating_aggregate(
    State(state): State<Arc<AppState>>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!("handling get rating aggregate request");

    match state.ratings_usecase.get_rating_info(route_id, None).await {
        Ok(info) => {
            tracing::debug!(route_id = %route_id, average = info.average, count = info.count, "rating aggregate retrieved");
            Ok((
                StatusCode::OK,
                Json(RatingAggregateResponse {
                    average: info.average,
                    count: info.count,
                }),
            ))
        }
        Err(e) => {
            tracing::error!(route_id = %route_id, error = %e, "failed to get rating aggregate");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get rating aggregate: {}", e),
            ))
        }
    }
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id, route_id = %route_id))]
pub async fn get_user_rating(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!("handling get user rating request");

    match state
        .ratings_usecase
        .get_rating_info(route_id, Some(user.user_id))
        .await
    {
        Ok(info) => {
            tracing::debug!(route_id = %route_id, ?info.user_rating, "user rating retrieved");
            Ok((
                StatusCode::OK,
                Json(UserRatingResponse {
                    rating: info.user_rating,
                }),
            ))
        }
        Err(e) => {
            tracing::error!(route_id = %route_id, error = %e, "failed to get user rating");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get user rating: {}", e),
            ))
        }
    }
}
