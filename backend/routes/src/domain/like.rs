use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct RouteLike {
    pub id: Uuid,
    pub route_id: Uuid,
    pub user_id: Uuid,
    pub created_at: DateTime<Utc>,
}

impl RouteLike {
    pub fn new(route_id: Uuid, user_id: Uuid) -> Self {
        Self {
            id: Uuid::new_v4(),
            route_id,
            user_id,
            created_at: Utc::now(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_route_like_creation() {
        let route_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let like = RouteLike::new(route_id, user_id);

        assert_eq!(like.route_id, route_id);
        assert_eq!(like.user_id, user_id);
    }
}
