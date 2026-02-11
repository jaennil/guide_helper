use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PhotoStatus {
    Pending,
    Processing,
    Done,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PhotoData {
    pub original: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
    pub status: PhotoStatus,
}

/// Deserializes photo field with backward compatibility.
/// Accepts either a plain string (old format) or a PhotoData struct (new format).
fn deserialize_photo_compat<'de, D>(deserializer: D) -> Result<Option<PhotoData>, D::Error>
where
    D: Deserializer<'de>,
{
    let value: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    match value {
        None => Ok(None),
        Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(s)) => Ok(Some(PhotoData {
            original: s,
            thumbnail_url: None,
            status: PhotoStatus::Pending,
        })),
        Some(obj @ serde_json::Value::Object(_)) => {
            let photo_data: PhotoData =
                serde_json::from_value(obj).map_err(serde::de::Error::custom)?;
            Ok(Some(photo_data))
        }
        Some(other) => Err(serde::de::Error::custom(format!(
            "expected string or object for photo, got: {}",
            other
        ))),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RoutePoint {
    pub lat: f64,
    pub lng: f64,
    pub name: Option<String>,
    pub segment_mode: Option<String>,
    #[serde(deserialize_with = "deserialize_photo_compat", default)]
    pub photo: Option<PhotoData>,
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
            RoutePoint {
                lat: 55.7558,
                lng: 37.6173,
                name: Some("Moscow".to_string()),
                segment_mode: None,
                photo: None,
            },
            RoutePoint {
                lat: 59.9343,
                lng: 30.3351,
                name: Some("Saint Petersburg".to_string()),
                segment_mode: Some("auto".to_string()),
                photo: Some(PhotoData {
                    original: "data:image/png;base64,test".to_string(),
                    thumbnail_url: None,
                    status: PhotoStatus::Pending,
                }),
            },
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
        let points = vec![RoutePoint {
            lat: 55.7558,
            lng: 37.6173,
            name: None,
            segment_mode: None,
            photo: None,
        }];
        let mut route = Route::new(user_id, "Original".to_string(), points);
        let original_updated_at = route.updated_at;

        std::thread::sleep(std::time::Duration::from_millis(10));

        let new_points = vec![
            RoutePoint {
                lat: 55.7558,
                lng: 37.6173,
                name: None,
                segment_mode: None,
                photo: None,
            },
            RoutePoint {
                lat: 59.9343,
                lng: 30.3351,
                name: None,
                segment_mode: Some("auto".to_string()),
                photo: None,
            },
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
            photo: Some(PhotoData {
                original: "data:image/png;base64,test".to_string(),
                thumbnail_url: None,
                status: PhotoStatus::Pending,
            }),
        };

        let json = serde_json::to_string(&point).unwrap();
        let deserialized: RoutePoint = serde_json::from_str(&json).unwrap();

        assert_eq!(point, deserialized);
    }

    #[test]
    fn test_backward_compat_plain_string_photo() {
        let json = r#"{"lat":55.0,"lng":37.0,"name":null,"segment_mode":null,"photo":"data:image/png;base64,abc"}"#;
        let point: RoutePoint = serde_json::from_str(json).unwrap();

        let photo = point.photo.unwrap();
        assert_eq!(photo.original, "data:image/png;base64,abc");
        assert_eq!(photo.status, PhotoStatus::Pending);
        assert!(photo.thumbnail_url.is_none());
    }

    #[test]
    fn test_backward_compat_null_photo() {
        let json = r#"{"lat":55.0,"lng":37.0,"name":null,"segment_mode":null,"photo":null}"#;
        let point: RoutePoint = serde_json::from_str(json).unwrap();
        assert!(point.photo.is_none());
    }

    #[test]
    fn test_photo_data_struct_deserialization() {
        let json = r#"{"lat":55.0,"lng":37.0,"name":null,"segment_mode":null,"photo":{"original":"data:image/png;base64,abc","thumbnail_url":"/photos/thumb.jpg","status":"done"}}"#;
        let point: RoutePoint = serde_json::from_str(json).unwrap();

        let photo = point.photo.unwrap();
        assert_eq!(photo.original, "data:image/png;base64,abc");
        assert_eq!(photo.thumbnail_url, Some("/photos/thumb.jpg".to_string()));
        assert_eq!(photo.status, PhotoStatus::Done);
    }

    #[test]
    fn test_photo_status_serialization() {
        let photo = PhotoData {
            original: "test".to_string(),
            thumbnail_url: Some("/thumb.jpg".to_string()),
            status: PhotoStatus::Done,
        };
        let json = serde_json::to_string(&photo).unwrap();
        assert!(json.contains("\"status\":\"done\""));
        assert!(json.contains("\"thumbnail_url\":\"/thumb.jpg\""));
    }
}
