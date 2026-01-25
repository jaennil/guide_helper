use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RoutePoint {
    pub lat: f64,
    pub lng: f64,
    pub name: Option<String>,
    pub segment_mode: Option<String>, // "auto" or "manual" - mode for segment TO this point
    pub photo: Option<String>,        // base64 encoded image
}

#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct Route {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    #[sqlx(json)]
    pub points: Vec<RoutePoint>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Route {
    pub fn new(user_id: Uuid, name: String, points: Vec<RoutePoint>) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            user_id,
            name,
            points,
            created_at: now,
            updated_at: now,
        }
    }

    pub fn update(&mut self, name: Option<String>, points: Option<Vec<RoutePoint>>) {
        if let Some(n) = name {
            self.name = n;
        }
        if let Some(p) = points {
            self.points = p;
        }
        self.updated_at = Utc::now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_route_creation() {
        let user_id = Uuid::new_v4();
        let points = vec![
            RoutePoint { lat: 55.7558, lng: 37.6173, name: Some("Moscow".to_string()), segment_mode: None, photo: None },
            RoutePoint { lat: 59.9343, lng: 30.3351, name: Some("Saint Petersburg".to_string()), segment_mode: Some("auto".to_string()), photo: Some("data:image/png;base64,test".to_string()) },
        ];

        let route = Route::new(user_id, "Test Route".to_string(), points.clone());

        assert_eq!(route.user_id, user_id);
        assert_eq!(route.name, "Test Route");
        assert_eq!(route.points.len(), 2);
        assert_eq!(route.created_at, route.updated_at);
    }

    #[test]
    fn test_route_update() {
        let user_id = Uuid::new_v4();
        let points = vec![RoutePoint { lat: 55.7558, lng: 37.6173, name: None, segment_mode: None, photo: None }];
        let mut route = Route::new(user_id, "Original".to_string(), points);
        let original_updated_at = route.updated_at;

        std::thread::sleep(std::time::Duration::from_millis(10));

        let new_points = vec![
            RoutePoint { lat: 55.7558, lng: 37.6173, name: None, segment_mode: None, photo: None },
            RoutePoint { lat: 59.9343, lng: 30.3351, name: None, segment_mode: Some("auto".to_string()), photo: None },
        ];
        route.update(Some("Updated".to_string()), Some(new_points));

        assert_eq!(route.name, "Updated");
        assert_eq!(route.points.len(), 2);
        assert!(route.updated_at > original_updated_at);
    }

    #[test]
    fn test_route_point_serialization() {
        let point = RoutePoint {
            lat: 55.7558,
            lng: 37.6173,
            name: Some("Moscow".to_string()),
            segment_mode: Some("auto".to_string()),
            photo: Some("data:image/png;base64,test".to_string()),
        };

        let json = serde_json::to_string(&point).unwrap();
        let deserialized: RoutePoint = serde_json::from_str(&json).unwrap();

        assert_eq!(point, deserialized);
    }
}
