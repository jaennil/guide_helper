use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::delivery::http::v1::middleware::AuthenticatedUser;
use crate::usecase::contracts::{CommentRepository, RouteRepository};
use crate::usecase::error::UsecaseError;
use crate::AppState;

#[derive(Serialize)]
pub struct RoutesStatsResponse {
    pub total_routes: i64,
    pub total_comments: i64,
}

#[derive(Debug, Deserialize)]
pub struct AdminListParams {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Serialize)]
pub struct AdminRouteResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub points_count: i64,
    pub created_at: DateTime<Utc>,
    pub share_token: Option<Uuid>,
    pub tags: Vec<String>,
}

#[derive(Serialize)]
pub struct AdminRoutesListResponse {
    pub routes: Vec<AdminRouteResponse>,
    pub total: i64,
}

#[derive(Serialize)]
pub struct AdminCommentResponse {
    pub id: Uuid,
    pub route_id: Uuid,
    pub user_id: Uuid,
    pub author_name: String,
    pub text: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct AdminCommentsListResponse {
    pub comments: Vec<AdminCommentResponse>,
    pub total: i64,
}

pub(crate) fn require_admin(user: &AuthenticatedUser) -> Result<(), UsecaseError> {
    if user.role != "admin" {
        tracing::warn!(user_id = %user.user_id, role = %user.role, "non-admin access attempt to admin endpoint");
        return Err(UsecaseError::Forbidden("Admin access required".to_string()));
    }
    Ok(())
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id))]
pub async fn get_routes_stats(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<impl IntoResponse, UsecaseError> {
    require_admin(&user)?;

    tracing::debug!("getting routes admin stats");

    let total_routes = state.routes_usecase.route_repository().count_all().await?;
    let total_comments = state.comments_usecase.comment_repository().count_all().await?;

    tracing::debug!(total_routes, total_comments, "routes admin stats retrieved");
    Ok((StatusCode::OK, Json(RoutesStatsResponse { total_routes, total_comments })))
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id))]
pub async fn list_admin_routes(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Query(params): Query<AdminListParams>,
) -> Result<impl IntoResponse, UsecaseError> {
    require_admin(&user)?;

    let limit = params.limit.unwrap_or(20).min(100);
    let offset = params.offset.unwrap_or(0);
    tracing::debug!(limit, offset, "listing admin routes");

    let total = state.routes_usecase.route_repository().count_all().await?;
    let rows = state.routes_usecase.route_repository().find_all_admin(limit, offset).await?;

    let routes: Vec<AdminRouteResponse> = rows
        .into_iter()
        .map(|r| AdminRouteResponse {
            id: r.id,
            user_id: r.user_id,
            name: r.name,
            points_count: r.points_count,
            created_at: r.created_at,
            share_token: r.share_token,
            tags: r.tags,
        })
        .collect();

    tracing::debug!(count = routes.len(), total, "admin routes listed");
    Ok((StatusCode::OK, Json(AdminRoutesListResponse { routes, total })))
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id))]
pub async fn list_admin_comments(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Query(params): Query<AdminListParams>,
) -> Result<impl IntoResponse, UsecaseError> {
    require_admin(&user)?;

    let limit = params.limit.unwrap_or(20).min(100);
    let offset = params.offset.unwrap_or(0);
    tracing::debug!(limit, offset, "listing admin comments");

    let total = state.comments_usecase.comment_repository().count_all().await?;
    let rows = state.comments_usecase.comment_repository().find_all_paginated(limit, offset).await?;

    let comments: Vec<AdminCommentResponse> = rows
        .into_iter()
        .map(|c| AdminCommentResponse {
            id: c.id,
            route_id: c.route_id,
            user_id: c.user_id,
            author_name: c.author_name,
            text: c.text,
            created_at: c.created_at,
        })
        .collect();

    tracing::debug!(count = comments.len(), total, "admin comments listed");
    Ok((StatusCode::OK, Json(AdminCommentsListResponse { comments, total })))
}
