use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::delivery::http::v1::middleware::AuthenticatedUser;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct NotificationListParams {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Serialize)]
pub struct NotificationResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub notification_type: String,
    pub route_id: Uuid,
    pub actor_name: String,
    pub message: String,
    pub is_read: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct NotificationsListResponse {
    pub notifications: Vec<NotificationResponse>,
    pub unread_count: i64,
}

#[derive(Serialize)]
pub struct UnreadCountResponse {
    pub unread_count: i64,
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id))]
pub async fn list_notifications(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Query(params): Query<NotificationListParams>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let limit = params.limit.unwrap_or(20).min(100);
    let offset = params.offset.unwrap_or(0);
    tracing::debug!(limit, offset, "listing notifications");

    let notifications = state
        .notifications_usecase
        .list_notifications(user.user_id, limit, offset)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to list notifications");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to list notifications: {}", e))
        })?;

    let unread_count = state
        .notifications_usecase
        .count_unread(user.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to count unread notifications");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to count unread: {}", e))
        })?;

    let response: Vec<NotificationResponse> = notifications
        .into_iter()
        .map(|n| NotificationResponse {
            id: n.id,
            user_id: n.user_id,
            notification_type: n.notification_type,
            route_id: n.route_id,
            actor_name: n.actor_name,
            message: n.message,
            is_read: n.is_read,
            created_at: n.created_at,
        })
        .collect();

    tracing::debug!(count = response.len(), unread_count, "notifications listed");
    Ok((StatusCode::OK, Json(NotificationsListResponse { notifications: response, unread_count })))
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id))]
pub async fn get_unread_count(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!("getting unread notification count");

    let unread_count = state
        .notifications_usecase
        .count_unread(user.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to count unread notifications");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to count unread: {}", e))
        })?;

    tracing::debug!(unread_count, "unread count retrieved");
    Ok((StatusCode::OK, Json(UnreadCountResponse { unread_count })))
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id, notification_id = %id))]
pub async fn mark_as_read(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!("marking notification as read");

    state
        .notifications_usecase
        .mark_as_read(id, user.user_id)
        .await
        .map_err(|e| {
            let error_msg = e.to_string();
            if error_msg.contains("Not found") || error_msg.contains("NotFound") {
                tracing::warn!(notification_id = %id, "notification not found");
                (StatusCode::NOT_FOUND, "Notification not found".to_string())
            } else {
                tracing::error!(notification_id = %id, error = %e, "failed to mark notification as read");
                (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to mark as read: {}", e))
            }
        })?;

    tracing::debug!(notification_id = %id, "notification marked as read");
    Ok(StatusCode::NO_CONTENT)
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id))]
pub async fn mark_all_as_read(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!("marking all notifications as read");

    state
        .notifications_usecase
        .mark_all_as_read(user.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to mark all notifications as read");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to mark all as read: {}", e))
        })?;

    tracing::debug!("all notifications marked as read");
    Ok(StatusCode::NO_CONTENT)
}
