use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::Validate;

use crate::delivery::http::v1::middleware::AuthenticatedUser;
use crate::usecase::contracts::RouteRepository;
use crate::usecase::error::UsecaseError;
use crate::AppState;

#[derive(Serialize)]
pub struct CommentResponse {
    pub id: Uuid,
    pub route_id: Uuid,
    pub user_id: Uuid,
    pub author_name: String,
    pub text: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Deserialize, Validate)]
pub struct CreateCommentRequest {
    #[validate(length(min = 1, max = 2000))]
    pub text: String,
    #[validate(length(min = 1, max = 100))]
    pub author_name: String,
}

#[tracing::instrument(skip(state, payload), fields(user_id = %user.user_id, route_id = %route_id))]
pub async fn create_comment(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(route_id): Path<Uuid>,
    Json(payload): Json<CreateCommentRequest>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!("handling create comment request");

    if let Err(validation_errors) = payload.validate() {
        tracing::warn!(user_id = %user.user_id, ?validation_errors, "validation failed");
        return Err(UsecaseError::Validation(format!("{:?}", validation_errors)));
    }

    let comment = state
        .comments_usecase
        .create_comment(route_id, user.user_id, payload.author_name, payload.text)
        .await?;

    tracing::debug!(comment_id = %comment.id, "comment created successfully");

    // Emit notification to route owner (best-effort)
    if let Ok(Some(route)) = state.routes_usecase.route_repository().find_by_id(route_id).await {
        if route.user_id != user.user_id {
            let msg = format!("{} commented on your route \"{}\"", &comment.author_name, &route.name);
            if let Err(e) = state.notifications_usecase.create_notification(
                route.user_id,
                "comment".to_string(),
                route_id,
                comment.author_name.clone(),
                msg,
            ).await {
                tracing::error!(error = %e, "failed to create comment notification");
            }
        }
    }

    Ok((
        StatusCode::CREATED,
        Json(CommentResponse {
            id: comment.id,
            route_id: comment.route_id,
            user_id: comment.user_id,
            author_name: comment.author_name,
            text: comment.text,
            created_at: comment.created_at,
        }),
    ))
}

#[tracing::instrument(skip(state), fields(route_id = %route_id))]
pub async fn list_comments(
    State(state): State<Arc<AppState>>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!("handling list comments request");

    let comments = state.comments_usecase.list_comments(route_id).await?;

    let response: Vec<CommentResponse> = comments
        .into_iter()
        .map(|c| CommentResponse {
            id: c.id,
            route_id: c.route_id,
            user_id: c.user_id,
            author_name: c.author_name,
            text: c.text,
            created_at: c.created_at,
        })
        .collect();

    tracing::debug!(route_id = %route_id, count = response.len(), "comments listed successfully");
    Ok((StatusCode::OK, Json(response)))
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id, comment_id = %comment_id))]
pub async fn delete_comment(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(comment_id): Path<Uuid>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!("handling delete comment request");

    state
        .comments_usecase
        .delete_comment(comment_id, user.user_id, &user.role)
        .await?;

    tracing::debug!(comment_id = %comment_id, "comment deleted successfully");
    Ok(StatusCode::NO_CONTENT)
}

#[tracing::instrument(skip(state), fields(route_id = %route_id))]
pub async fn count_comments(
    State(state): State<Arc<AppState>>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!("handling count comments request");

    let count = state.comments_usecase.count_comments(route_id).await?;

    tracing::debug!(route_id = %route_id, count, "comment count retrieved");
    Ok((StatusCode::OK, Json(serde_json::json!({ "count": count }))))
}
