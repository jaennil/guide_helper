use std::sync::Arc;
use std::convert::Infallible;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, sse::{Event, Sse}},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::delivery::http::v1::middleware::AuthenticatedUser;
use crate::usecase::chat::{ChatAction, ChatStreamEvent};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub message: String,
    pub conversation_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct ListConversationsQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Serialize)]
pub struct ConversationSummaryResponse {
    pub conversation_id: Uuid,
    pub last_message: String,
    pub message_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub title: String,
}

#[derive(Serialize)]
pub struct ListConversationsResponse {
    pub conversations: Vec<ConversationSummaryResponse>,
    pub total: i64,
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

    // Validate message length
    let max_len = state.chat_usecase.max_message_length();
    if body.message.is_empty() || body.message.len() > max_len {
        tracing::warn!(
            user_id = %user.user_id,
            message_len = body.message.len(),
            max_len,
            "message validation failed"
        );
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Message must be between 1 and {} characters", max_len),
        ));
    }

    tracing::info!(
        %conversation_id,
        message_len = body.message.len(),
        "processing chat message"
    );

    metrics::counter!("chat_messages_total", "role" => "user").increment(1);

    // Rate limiting check
    {
        let now = std::time::Instant::now();
        let mut limits = state.chat_rate_limits.write().await;
        let entry = limits
            .entry(user.user_id)
            .or_insert((now, 0));

        if now.duration_since(entry.0).as_secs() >= state.chat_rate_limit_window_secs {
            *entry = (now, 1);
        } else {
            entry.1 += 1;
            if entry.1 > state.chat_rate_limit_max {
                tracing::warn!(user_id = %user.user_id, "chat rate limit exceeded");
                metrics::counter!("chat_rate_limited_total").increment(1);
                return Err((
                    StatusCode::TOO_MANY_REQUESTS,
                    "Too many requests. Please try again later.".to_string(),
                ));
            }
        }
    }

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

#[tracing::instrument(skip(state), fields(user_id = %user.user_id))]
pub async fn list_conversations(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Query(query): Query<ListConversationsQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let limit = query.limit.unwrap_or(20).min(100);
    let offset = query.offset.unwrap_or(0);

    tracing::debug!(%limit, %offset, "listing conversations");

    let conversations = state
        .chat_usecase
        .list_conversations(user.user_id, limit, offset)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to list conversations");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to list conversations: {}", e),
            )
        })?;

    let total = state
        .chat_usecase
        .count_conversations(user.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to count conversations");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to count conversations: {}", e),
            )
        })?;

    let items: Vec<ConversationSummaryResponse> = conversations
        .into_iter()
        .map(|c| ConversationSummaryResponse {
            conversation_id: c.conversation_id,
            last_message: c.last_message,
            message_count: c.message_count,
            created_at: c.created_at,
            updated_at: c.updated_at,
            title: c.title,
        })
        .collect();

    tracing::debug!(count = items.len(), total, "conversations listed");
    Ok((StatusCode::OK, Json(ListConversationsResponse {
        conversations: items,
        total,
    })))
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id, conversation_id = %conversation_id))]
pub async fn delete_conversation(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(conversation_id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::info!("deleting conversation");

    state
        .chat_usecase
        .delete_conversation(user.user_id, conversation_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to delete conversation");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to delete conversation: {}", e),
            )
        })?;

    tracing::info!("conversation deleted");
    Ok(StatusCode::NO_CONTENT)
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id, conversation_id = %conversation_id, message_id = %message_id))]
pub async fn delete_message(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path((conversation_id, message_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::info!("deleting message");

    let _ = conversation_id; // included in path for REST convention

    state
        .chat_usecase
        .delete_message(user.user_id, message_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to delete message");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to delete message: {}", e),
            )
        })?;

    tracing::info!("message deleted");
    Ok(StatusCode::NO_CONTENT)
}

#[tracing::instrument(skip(state, body), fields(user_id = %user.user_id))]
pub async fn send_chat_message_stream(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(body): Json<SendMessageRequest>,
) -> Result<Sse<impl futures::Stream<Item = Result<Event, Infallible>>>, (StatusCode, String)> {
    let conversation_id = body.conversation_id.unwrap_or_else(|| {
        let id = Uuid::new_v4();
        tracing::info!(%id, "created new conversation for stream");
        id
    });

    // Validate message length
    let max_len = state.chat_usecase.max_message_length();
    if body.message.is_empty() || body.message.len() > max_len {
        tracing::warn!(user_id = %user.user_id, message_len = body.message.len(), "stream message validation failed");
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Message must be between 1 and {} characters", max_len),
        ));
    }

    // Rate limiting check
    {
        let now = std::time::Instant::now();
        let mut limits = state.chat_rate_limits.write().await;
        let entry = limits.entry(user.user_id).or_insert((now, 0));

        if now.duration_since(entry.0).as_secs() >= state.chat_rate_limit_window_secs {
            *entry = (now, 1);
        } else {
            entry.1 += 1;
            if entry.1 > state.chat_rate_limit_max {
                tracing::warn!(user_id = %user.user_id, "chat stream rate limit exceeded");
                metrics::counter!("chat_rate_limited_total").increment(1);
                return Err((
                    StatusCode::TOO_MANY_REQUESTS,
                    "Too many requests. Please try again later.".to_string(),
                ));
            }
        }
    }

    if !state.chat_usecase.is_available() {
        tracing::warn!("chat stream request received but Ollama is not available");
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "AI assistant is currently unavailable".to_string(),
        ));
    }

    metrics::counter!("chat_messages_total", "role" => "user").increment(1);

    let (_response, event_stream) = state
        .chat_usecase
        .send_message_stream(user.user_id, conversation_id, body.message)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to start chat stream");
            metrics::counter!("chat_errors_total").increment(1);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Chat error: {}", e),
            )
        })?;

    let sse_stream = event_stream.map(|result| {
        match result {
            Ok(event) => {
                let data = serde_json::to_string(&event).unwrap_or_default();
                let event_type = match &event {
                    ChatStreamEvent::Token { .. } => "token",
                    ChatStreamEvent::Actions { .. } => "actions",
                    ChatStreamEvent::Done { .. } => "done",
                    ChatStreamEvent::Error { .. } => "error",
                };
                Ok(Event::default().event(event_type).data(data))
            }
            Err(e) => {
                tracing::error!(error = %e, "stream error");
                let error_event = ChatStreamEvent::Error { message: e.to_string() };
                let data = serde_json::to_string(&error_event).unwrap_or_default();
                Ok(Event::default().event("error").data(data))
            }
        }
    });

    tracing::info!(%conversation_id, "SSE stream started");
    Ok(Sse::new(sse_stream))
}

#[derive(Serialize)]
pub struct ChatHealthResponse {
    pub available: bool,
    pub model: String,
}

#[tracing::instrument(skip(state))]
pub async fn chat_health(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let available = state.chat_usecase.check_health().await;
    let model = state.chat_usecase.model_name().to_string();

    tracing::debug!(%available, %model, "chat health check");

    (
        StatusCode::OK,
        Json(ChatHealthResponse { available, model }),
    )
}
