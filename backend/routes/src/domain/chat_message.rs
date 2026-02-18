use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ChatMessage {
    pub id: Uuid,
    pub user_id: Uuid,
    pub conversation_id: Uuid,
    pub role: String,
    pub content: String,
    pub actions: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

impl ChatMessage {
    pub fn new_user_message(user_id: Uuid, conversation_id: Uuid, content: String) -> Self {
        Self {
            id: Uuid::new_v4(),
            user_id,
            conversation_id,
            role: "user".to_string(),
            content,
            actions: None,
            created_at: Utc::now(),
        }
    }

    pub fn new_assistant_message(
        user_id: Uuid,
        conversation_id: Uuid,
        content: String,
        actions: Option<serde_json::Value>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            user_id,
            conversation_id,
            role: "assistant".to_string(),
            content,
            actions,
            created_at: Utc::now(),
        }
    }
}
