use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Comment {
    pub id: Uuid,
    pub route_id: Uuid,
    pub user_id: Uuid,
    pub author_name: String,
    pub text: String,
    pub created_at: DateTime<Utc>,
}

impl Comment {
    pub fn new(route_id: Uuid, user_id: Uuid, author_name: String, text: String) -> Self {
        Self {
            id: Uuid::new_v4(),
            route_id,
            user_id,
            author_name,
            text,
            created_at: Utc::now(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_comment_creation() {
        let route_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let comment = Comment::new(
            route_id,
            user_id,
            "Test User".to_string(),
            "Great route!".to_string(),
        );

        assert_eq!(comment.route_id, route_id);
        assert_eq!(comment.user_id, user_id);
        assert_eq!(comment.author_name, "Test User");
        assert_eq!(comment.text, "Great route!");
    }
}
