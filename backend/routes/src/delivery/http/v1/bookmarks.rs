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
use crate::delivery::http::v1::routes::ExploreRouteResponse;
use crate::usecase::error::UsecaseError;
use crate::AppState;

#[derive(Serialize)]
pub struct ToggleBookmarkResponse {
    pub bookmarked: bool,
}

#[derive(Serialize)]
pub struct UserBookmarkStatusResponse {
    pub bookmarked: bool,
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id, route_id = %route_id))]
pub async fn toggle_bookmark(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!("handling toggle bookmark request");

    let bookmarked = state
        .bookmarks_usecase
        .toggle_bookmark(route_id, user.user_id)
        .await?;

    tracing::debug!(route_id = %route_id, bookmarked, "bookmark toggled successfully");
    Ok((StatusCode::OK, Json(ToggleBookmarkResponse { bookmarked })))
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id, route_id = %route_id))]
pub async fn get_user_bookmark_status(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!("handling get user bookmark status request");

    let bookmarked = state
        .bookmarks_usecase
        .get_user_bookmark_status(route_id, user.user_id)
        .await?;

    tracing::debug!(route_id = %route_id, bookmarked, "user bookmark status retrieved");
    Ok((StatusCode::OK, Json(UserBookmarkStatusResponse { bookmarked })))
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id))]
pub async fn list_bookmarks(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!("handling list bookmarks request");

    let rows = state
        .bookmarks_usecase
        .list_bookmarks(user.user_id)
        .await?;

    let response: Vec<ExploreRouteResponse> = rows
        .into_iter()
        .map(|r| ExploreRouteResponse {
            id: r.id,
            name: r.name,
            points_count: r.points_count,
            created_at: r.created_at,
            share_token: r.share_token.to_string(),
            likes_count: r.likes_count,
            avg_rating: r.avg_rating,
            ratings_count: r.ratings_count,
            category_ids: r.category_ids,
            seasons: r.seasons,
        })
        .collect();

    tracing::debug!(user_id = %user.user_id, count = response.len(), "bookmarks listed");
    Ok((StatusCode::OK, Json(response)))
}
