use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Notification {
    pub id: Uuid,
    pub user_id: Uuid,
    pub notification_type: String,
    pub route_id: Uuid,
    pub actor_name: String,
    pub message: String,
    pub is_read: bool,
    pub created_at: DateTime<Utc>,
}

impl Notification {
    pub fn new(
        user_id: Uuid,
        notification_type: String,
        route_id: Uuid,
        actor_name: String,
        message: String,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            user_id,
            notification_type,
            route_id,
            actor_name,
            message,
            is_read: false,
            created_at: Utc::now(),
        }
    }
}
