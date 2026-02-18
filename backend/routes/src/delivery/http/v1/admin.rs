use std::sync::Arc;

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use serde::Serialize;

use crate::delivery::http::v1::middleware::AuthenticatedUser;
use crate::usecase::contracts::{CommentRepository, RouteRepository};
use crate::AppState;

#[derive(Serialize)]
pub struct RoutesStatsResponse {
    pub total_routes: i64,
    pub total_comments: i64,
}

pub(crate) fn require_admin(user: &AuthenticatedUser) -> Result<(), (StatusCode, String)> {
    if user.role != "admin" {
        tracing::warn!(user_id = %user.user_id, role = %user.role, "non-admin access attempt to admin endpoint");
        return Err((StatusCode::FORBIDDEN, "Admin access required".to_string()));
    }
    Ok(())
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id))]
pub async fn get_routes_stats(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    require_admin(&user)?;

    tracing::debug!("getting routes admin stats");

    let total_routes = state.routes_usecase.route_repository().count_all().await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to count routes");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to get stats: {}", e))
        })?;

    let total_comments = state.comments_usecase.comment_repository().count_all().await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to count comments");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to get stats: {}", e))
        })?;

    tracing::debug!(total_routes, total_comments, "routes admin stats retrieved");
    Ok((StatusCode::OK, Json(RoutesStatsResponse { total_routes, total_comments })))
}
