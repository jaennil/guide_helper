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

use crate::delivery::http::v1::middleware::AuthenticatedUser;
use crate::usecase::chat::ChatAction;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub message: String,
    pub conversation_id: Option<Uuid>,
}

#[derive(Serialize)]
pub struct ChatMessageResponse {
    pub id: Uuid,
    pub message: String,
    pub actions: Vec<ChatAction>,
    pub conversation_id: Uuid,
}

#[derive(Serialize)]
pub struct ChatHistoryMessage {
    pub id: Uuid,
    pub role: String,
    pub content: String,
    pub actions: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

#[tracing::instrument(skip(state, body), fields(user_id = %user.user_id))]
pub async fn send_chat_message(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(body): Json<SendMessageRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let conversation_id = body.conversation_id.unwrap_or_else(|| {
        let id = Uuid::new_v4();
        tracing::info!(%id, "created new conversation");
        id
    });

    tracing::info!(
        %conversation_id,
        message_len = body.message.len(),
        "processing chat message"
    );

    metrics::counter!("chat_messages_total", "role" => "user").increment(1);

    if !state.chat_usecase.is_available() {
        tracing::warn!("chat request received but Ollama is not available");
        metrics::counter!("chat_unavailable_total").increment(1);
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "AI assistant is currently unavailable".to_string(),
        ));
    }

    let start = std::time::Instant::now();

    let result = state
        .chat_usecase
        .send_message(user.user_id, conversation_id, body.message)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "chat message processing failed");
            metrics::counter!("chat_errors_total").increment(1);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Chat error: {}", e),
            )
        })?;

    let elapsed = start.elapsed().as_secs_f64();
    metrics::histogram!("chat_response_duration_seconds").record(elapsed);
    metrics::counter!("chat_messages_total", "role" => "assistant").increment(1);

    tracing::info!(
        response_id = %result.id,
        actions_count = result.actions.len(),
        elapsed_secs = elapsed,
        "chat message processed successfully"
    );

    Ok((
        StatusCode::OK,
        Json(ChatMessageResponse {
            id: result.id,
            message: result.message,
            actions: result.actions,
            conversation_id: result.conversation_id,
        }),
    ))
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id, conversation_id = %conversation_id))]
pub async fn get_chat_history(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(conversation_id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!("fetching chat history");

    let messages = state
        .chat_usecase
        .get_history(user.user_id, conversation_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to fetch chat history");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to get chat history: {}", e),
            )
        })?;

    let response: Vec<ChatHistoryMessage> = messages
        .into_iter()
        .map(|m| ChatHistoryMessage {
            id: m.id,
            role: m.role,
            content: m.content,
            actions: m.actions,
            created_at: m.created_at,
        })
        .collect();

    tracing::debug!(count = response.len(), "chat history fetched");
    Ok((StatusCode::OK, Json(response)))
}
