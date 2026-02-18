use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use serde::Serialize;
use uuid::Uuid;

use crate::delivery::http::v1::middleware::AuthenticatedUser;
use crate::usecase::contracts::RouteRepository;
use crate::AppState;

#[derive(Serialize)]
pub struct LikeCountResponse {
    pub count: i64,
}

#[derive(Serialize)]
pub struct ToggleLikeResponse {
    pub liked: bool,
    pub count: i64,
}

#[derive(Serialize)]
pub struct UserLikeStatusResponse {
    pub liked: bool,
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id, route_id = %route_id))]
pub async fn toggle_like(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!("handling toggle like request");

    let liked = match state
        .likes_usecase
        .toggle_like(route_id, user.user_id)
        .await
    {
        Ok(liked) => liked,
        Err(e) => {
            let error_msg = e.to_string();
            if error_msg.contains("not found") {
                tracing::warn!(route_id = %route_id, "route not found for like toggle");
                return Err((StatusCode::NOT_FOUND, "Route not found".to_string()));
            }
            tracing::error!(route_id = %route_id, error = %e, "failed to toggle like");
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to toggle like: {}", e),
            ));
        }
    };

    let count = state
        .likes_usecase
        .get_like_count(route_id)
        .await
        .map_err(|e| {
            tracing::error!(route_id = %route_id, error = %e, "failed to get like count after toggle");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get like count: {}", e),
            )
        })?;

    // Emit notification to route owner on like (not unlike)
    if liked {
        if let Ok(Some(route)) = state.routes_usecase.route_repository().find_by_id(route_id).await {
            if route.user_id != user.user_id {
                let msg = format!("{} liked your route \"{}\"", &user.email, &route.name);
                if let Err(e) = state.notifications_usecase.create_notification(
                    route.user_id,
                    "like".to_string(),
                    route_id,
                    user.email.clone(),
                    msg,
                ).await {
                    tracing::error!(error = %e, "failed to create like notification");
                }
            }
        }
    }

    tracing::debug!(route_id = %route_id, liked, count, "like toggled successfully");
    Ok((StatusCode::OK, Json(ToggleLikeResponse { liked, count })))
}

#[tracing::instrument(skip(state), fields(route_id = %route_id))]
pub async fn get_like_count(
    State(state): State<Arc<AppState>>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!("handling get like count request");

    match state.likes_usecase.get_like_count(route_id).await {
        Ok(count) => {
            tracing::debug!(route_id = %route_id, count, "like count retrieved");
            Ok((StatusCode::OK, Json(LikeCountResponse { count })))
        }
        Err(e) => {
            tracing::error!(route_id = %route_id, error = %e, "failed to get like count");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get like count: {}", e),
            ))
        }
    }
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id, route_id = %route_id))]
pub async fn get_user_like_status(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!("handling get user like status request");

    match state
        .likes_usecase
        .get_user_like_status(route_id, user.user_id)
        .await
    {
        Ok(liked) => {
            tracing::debug!(route_id = %route_id, liked, "user like status retrieved");
            Ok((StatusCode::OK, Json(UserLikeStatusResponse { liked })))
        }
        Err(e) => {
            tracing::error!(route_id = %route_id, error = %e, "failed to get user like status");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get user like status: {}", e),
            ))
        }
    }
}
