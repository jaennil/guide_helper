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
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!("handling create comment request");

    if let Err(validation_errors) = payload.validate() {
        tracing::warn!(user_id = %user.user_id, ?validation_errors, "validation failed");
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Validation error: {:?}", validation_errors),
        ));
    }

    match state
        .comments_usecase
        .create_comment(route_id, user.user_id, payload.author_name, payload.text)
        .await
    {
        Ok(comment) => {
            tracing::debug!(comment_id = %comment.id, "comment created successfully");
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
        Err(e) => {
            let error_msg = e.to_string();
            if error_msg.contains("not found") {
                tracing::warn!(route_id = %route_id, "route not found for comment");
                Err((StatusCode::NOT_FOUND, "Route not found".to_string()))
            } else {
                tracing::error!(route_id = %route_id, error = %e, "failed to create comment");
                Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to create comment: {}", e),
                ))
            }
        }
    }
}

#[tracing::instrument(skip(state), fields(route_id = %route_id))]
pub async fn list_comments(
    State(state): State<Arc<AppState>>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!("handling list comments request");

    match state.comments_usecase.list_comments(route_id).await {
        Ok(comments) => {
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
        Err(e) => {
            tracing::error!(route_id = %route_id, error = %e, "failed to list comments");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to list comments: {}", e),
            ))
        }
    }
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id, comment_id = %comment_id))]
pub async fn delete_comment(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(comment_id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!("handling delete comment request");

    match state
        .comments_usecase
        .delete_comment(comment_id, user.user_id)
        .await
    {
        Ok(()) => {
            tracing::debug!(comment_id = %comment_id, "comment deleted successfully");
            Ok(StatusCode::NO_CONTENT)
        }
        Err(e) => {
            let error_msg = e.to_string();
            if error_msg.contains("not found") {
                tracing::warn!(comment_id = %comment_id, "comment not found");
                Err((StatusCode::NOT_FOUND, "Comment not found".to_string()))
            } else if error_msg.contains("Not authorized") {
                tracing::warn!(comment_id = %comment_id, "unauthorized delete attempt");
                Err((StatusCode::FORBIDDEN, "Not authorized to delete this comment".to_string()))
            } else {
                tracing::error!(comment_id = %comment_id, error = %e, "failed to delete comment");
                Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to delete comment: {}", e),
                ))
            }
        }
    }
}

#[tracing::instrument(skip(state), fields(route_id = %route_id))]
pub async fn count_comments(
    State(state): State<Arc<AppState>>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!("handling count comments request");

    match state.comments_usecase.count_comments(route_id).await {
        Ok(count) => {
            tracing::debug!(route_id = %route_id, count, "comment count retrieved");
            Ok((StatusCode::OK, Json(serde_json::json!({ "count": count }))))
        }
        Err(e) => {
            tracing::error!(route_id = %route_id, error = %e, "failed to count comments");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to count comments: {}", e),
            ))
        }
    }
}
