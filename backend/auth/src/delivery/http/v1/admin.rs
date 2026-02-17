use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::delivery::http::v1::middleware::AuthenticatedUser;
use crate::usecase::contracts::UserRepository;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct UsersQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub search: Option<String>,
}

#[derive(Serialize)]
pub struct UserListItem {
    pub id: Uuid,
    pub email: String,
    pub name: Option<String>,
    pub role: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize)]
pub struct UsersListResponse {
    pub users: Vec<UserListItem>,
    pub total: i64,
}

#[derive(Deserialize)]
pub struct UpdateRoleRequest {
    pub role: String,
}

#[derive(Serialize)]
pub struct StatsResponse {
    pub total_users: i64,
    pub by_role: Vec<RoleStatItem>,
}

#[derive(Serialize)]
pub struct RoleStatItem {
    pub role: String,
    pub count: i64,
}

pub fn require_admin(user: &AuthenticatedUser) -> Result<(), (StatusCode, String)> {
    if user.role != "admin" {
        tracing::warn!(user_id = %user.user_id, role = %user.role, "non-admin access attempt to admin endpoint");
        return Err((StatusCode::FORBIDDEN, "Admin access required".to_string()));
    }
    Ok(())
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id))]
pub async fn list_users(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Query(params): Query<UsersQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    require_admin(&user)?;

    let limit = params.limit.unwrap_or(20).min(100).max(1);
    let offset = params.offset.unwrap_or(0).max(0);
    let search = params.search.filter(|s| !s.is_empty());

    tracing::debug!(%limit, %offset, ?search, "listing users");

    let users = state.auth_usecase.user_repository().find_all_users(limit, offset, search.clone()).await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to list users");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to list users: {}", e))
        })?;

    let total = state.auth_usecase.user_repository().count_users(search).await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to count users");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to count users: {}", e))
        })?;

    let items: Vec<UserListItem> = users
        .into_iter()
        .map(|u| UserListItem {
            id: u.id,
            email: u.email,
            name: u.name,
            role: u.role,
            created_at: u.created_at,
        })
        .collect();

    tracing::debug!(count = items.len(), total, "users listed");
    Ok((StatusCode::OK, Json(UsersListResponse { users: items, total })))
}

#[tracing::instrument(skip(state, payload), fields(user_id = %user.user_id, target_user_id = %target_user_id))]
pub async fn update_user_role(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(target_user_id): Path<Uuid>,
    Json(payload): Json<UpdateRoleRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    require_admin(&user)?;

    // Validate role value
    let valid_roles = ["user", "moderator", "admin"];
    if !valid_roles.contains(&payload.role.as_str()) {
        tracing::warn!(role = %payload.role, "invalid role value");
        return Err((StatusCode::BAD_REQUEST, format!("Invalid role: {}. Must be one of: user, moderator, admin", payload.role)));
    }

    // Prevent admin from demoting themselves
    if target_user_id == user.user_id {
        tracing::warn!("admin attempted to change own role");
        return Err((StatusCode::BAD_REQUEST, "Cannot change your own role".to_string()));
    }

    tracing::info!(target_user_id = %target_user_id, new_role = %payload.role, "updating user role");

    state.auth_usecase.user_repository().update_role(target_user_id, &payload.role).await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to update user role");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to update role: {}", e))
        })?;

    tracing::info!(target_user_id = %target_user_id, new_role = %payload.role, "user role updated successfully");
    Ok((StatusCode::OK, Json(serde_json::json!({"message": "Role updated successfully"}))))
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id))]
pub async fn get_stats(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    require_admin(&user)?;

    tracing::debug!("getting admin stats");

    let total_users = state.auth_usecase.user_repository().count_users(None).await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to count users");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to get stats: {}", e))
        })?;

    let role_counts = state.auth_usecase.user_repository().count_users_by_role().await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to count users by role");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to get stats: {}", e))
        })?;

    let by_role: Vec<RoleStatItem> = role_counts
        .into_iter()
        .map(|rc| RoleStatItem {
            role: rc.role,
            count: rc.count,
        })
        .collect();

    tracing::debug!(total_users, role_count = by_role.len(), "admin stats retrieved");
    Ok((StatusCode::OK, Json(StatsResponse { total_users, by_role })))
}
