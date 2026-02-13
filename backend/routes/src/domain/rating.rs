use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct RouteRating {
    pub id: Uuid,
    pub route_id: Uuid,
    pub user_id: Uuid,
    pub rating: i16,
    pub created_at: DateTime<Utc>,
}

impl RouteRating {
    pub fn new(route_id: Uuid, user_id: Uuid, rating: i16) -> Self {
        Self {
            id: Uuid::new_v4(),
            route_id,
            user_id,
            rating,
            created_at: Utc::now(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RatingInfo {
    pub average: f64,
    pub count: i64,
    pub user_rating: Option<i16>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_route_rating_creation() {
        let route_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let rating = RouteRating::new(route_id, user_id, 4);

        assert_eq!(rating.route_id, route_id);
        assert_eq!(rating.user_id, user_id);
        assert_eq!(rating.rating, 4);
    }
}
