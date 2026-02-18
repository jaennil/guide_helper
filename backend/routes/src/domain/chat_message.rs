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

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ConversationSummary {
    pub conversation_id: Uuid,
    pub last_message: String,
    pub message_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_user_message() {
        let user_id = Uuid::new_v4();
        let conv_id = Uuid::new_v4();
        let msg = ChatMessage::new_user_message(user_id, conv_id, "hello".to_string());

        assert_eq!(msg.user_id, user_id);
        assert_eq!(msg.conversation_id, conv_id);
        assert_eq!(msg.role, "user");
        assert_eq!(msg.content, "hello");
        assert!(msg.actions.is_none());
    }

    #[test]
    fn test_new_assistant_message_without_actions() {
        let user_id = Uuid::new_v4();
        let conv_id = Uuid::new_v4();
        let msg =
            ChatMessage::new_assistant_message(user_id, conv_id, "response".to_string(), None);

        assert_eq!(msg.role, "assistant");
        assert_eq!(msg.content, "response");
        assert!(msg.actions.is_none());
    }

    #[test]
    fn test_new_assistant_message_with_actions() {
        let user_id = Uuid::new_v4();
        let conv_id = Uuid::new_v4();
        let actions = serde_json::json!([{"type": "show_points", "points": []}]);
        let msg = ChatMessage::new_assistant_message(
            user_id,
            conv_id,
            "here".to_string(),
            Some(actions.clone()),
        );

        assert_eq!(msg.role, "assistant");
        assert_eq!(msg.actions, Some(actions));
    }

    #[test]
    fn test_user_and_assistant_have_different_ids() {
        let user_id = Uuid::new_v4();
        let conv_id = Uuid::new_v4();
        let msg1 = ChatMessage::new_user_message(user_id, conv_id, "a".to_string());
        let msg2 = ChatMessage::new_assistant_message(user_id, conv_id, "b".to_string(), None);

        assert_ne!(msg1.id, msg2.id);
    }

    #[test]
    fn test_serialization_roundtrip() {
        let user_id = Uuid::new_v4();
        let conv_id = Uuid::new_v4();
        let msg = ChatMessage::new_user_message(user_id, conv_id, "test".to_string());

        let json = serde_json::to_string(&msg).unwrap();
        let deserialized: ChatMessage = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.id, msg.id);
        assert_eq!(deserialized.user_id, msg.user_id);
        assert_eq!(deserialized.conversation_id, msg.conversation_id);
        assert_eq!(deserialized.role, msg.role);
        assert_eq!(deserialized.content, msg.content);
    }
}
