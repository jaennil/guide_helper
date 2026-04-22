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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marker_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marker_size: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_size: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_shape: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment_duration_minutes: Option<u32>,
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
    pub started_at: Option<DateTime<Utc>>,
    pub share_token: Option<Uuid>,
    pub category_ids: Vec<Uuid>,
    pub start_location: Option<String>,
    pub end_location: Option<String>,
    pub seasons: Vec<String>,
    pub line_color: Option<String>,
    pub description: Option<String>,
    pub is_draft: bool,
    pub source_route_id: Option<Uuid>,
    pub version_group_id: Uuid,
    pub version_number: i32,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ExploreRouteRow {
    pub id: Uuid,
    pub name: String,
    pub points_count: i64,
    pub created_at: DateTime<Utc>,
    pub share_token: Uuid,
    pub likes_count: i64,
    pub avg_rating: f64,
    pub ratings_count: i64,
    pub category_ids: Vec<Uuid>,
    pub seasons: Vec<String>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AdminRouteRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub points_count: i64,
    pub created_at: DateTime<Utc>,
    pub share_token: Option<Uuid>,
    pub category_ids: Vec<Uuid>,
}

impl Route {
    pub fn new(
        user_id: Uuid,
        name: String,
        points: Vec<RoutePoint>,
        category_ids: Vec<Uuid>,
        seasons: Vec<String>,
        line_color: Option<String>,
        started_at: Option<DateTime<Utc>>,
        is_draft: bool,
        source_route_id: Option<Uuid>,
        version_group_id: Option<Uuid>,
        version_number: i32,
    ) -> Self {
        let now = Utc::now();
        let id = Uuid::new_v4();
        Self {
            id,
            user_id,
            name,
            points,
            created_at: now,
            updated_at: now,
            started_at,
            share_token: None,
            category_ids,
            start_location: None,
            end_location: None,
            seasons,
            line_color,
            description: None,
            is_draft,
            source_route_id,
            version_group_id: version_group_id.unwrap_or(id),
            version_number,
        }
    }

    pub fn update(
        &mut self,
        name: Option<String>,
        points: Option<Vec<RoutePoint>>,
        category_ids: Option<Vec<Uuid>>,
        seasons: Option<Vec<String>>,
        line_color: Option<String>,
        started_at: Option<Option<DateTime<Utc>>>,
        description: Option<String>,
        is_draft: Option<bool>,
    ) {
        if let Some(n) = name {
            self.name = n;
        }
        if let Some(p) = points {
            self.points = p;
        }
        if let Some(c) = category_ids {
            self.category_ids = c;
        }
        if let Some(s) = seasons {
            self.seasons = s;
        }
        if line_color.is_some() {
            self.line_color = line_color;
        }
        if let Some(started_at) = started_at {
            self.started_at = started_at;
        }
        if description.is_some() {
            self.description = description;
        }
        if let Some(is_draft) = is_draft {
            self.is_draft = is_draft;
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
                note: Some("Capital city point".to_string()),
                marker_color: Some("#ef4444".to_string()),
                marker_size: Some(30),
                preview_size: None,
                preview_shape: None,
                segment_mode: None,
                segment_duration_minutes: None,
                photo: None,
            },
            RoutePoint {
                lat: 59.9343,
                lng: 30.3351,
                name: Some("Saint Petersburg".to_string()),
                note: None,
                marker_color: Some("#22c55e".to_string()),
                marker_size: Some(34),
                preview_size: None,
                preview_shape: None,
                segment_mode: Some("auto".to_string()),
                segment_duration_minutes: Some(18),
                photo: Some(PhotoData {
                    original: "data:image/png;base64,test".to_string(),
                    thumbnail_url: None,
                    status: PhotoStatus::Pending,
                }),
            },
        ];

        let route = Route::new(
            user_id,
            "Test Route".to_string(),
            points.clone(),
            vec![],
            vec![],
            Some("#3388ff".to_string()),
            None,
            false,
            None,
            None,
            1,
        );

        assert_eq!(route.user_id, user_id);
        assert_eq!(route.name, "Test Route");
        assert_eq!(route.points.len(), 2);
        assert_eq!(route.created_at, route.updated_at);
        assert!(route.category_ids.is_empty());
        assert_eq!(route.line_color.as_deref(), Some("#3388ff"));
        assert!(!route.is_draft);
        assert_eq!(route.version_group_id, route.id);
        assert_eq!(route.version_number, 1);
    }

    #[test]
    fn test_route_update() {
        let user_id = Uuid::new_v4();
        let points = vec![RoutePoint {
            lat: 55.7558,
            lng: 37.6173,
            name: None,
            note: None,
            marker_color: None,
            marker_size: None,
            preview_size: None,
            preview_shape: None,
            segment_mode: None,
            segment_duration_minutes: None,
            photo: None,
        }];
        let mut route = Route::new(
            user_id,
            "Original".to_string(),
            points,
            vec![],
            vec![],
            Some("#3388ff".to_string()),
            None,
            false,
            None,
            None,
            1,
        );
        let original_updated_at = route.updated_at;

        std::thread::sleep(std::time::Duration::from_millis(10));

        let new_points = vec![
            RoutePoint {
                lat: 55.7558,
                lng: 37.6173,
                name: None,
                note: None,
                marker_color: None,
                marker_size: None,
                preview_size: None,
                preview_shape: None,
                segment_mode: None,
                segment_duration_minutes: None,
                photo: None,
            },
            RoutePoint {
                lat: 59.9343,
                lng: 30.3351,
                name: None,
                note: None,
                marker_color: None,
                marker_size: None,
                preview_size: None,
                preview_shape: None,
                segment_mode: Some("auto".to_string()),
                segment_duration_minutes: Some(24),
                photo: None,
            },
        ];
        route.update(
            Some("Updated".to_string()),
            Some(new_points),
            None,
            None,
            Some("#ef4444".to_string()),
            Some(Some(Utc::now())),
            None,
            Some(true),
        );

        assert_eq!(route.name, "Updated");
        assert_eq!(route.points.len(), 2);
        assert_eq!(route.line_color.as_deref(), Some("#ef4444"));
        assert!(route.started_at.is_some());
        assert!(route.is_draft);
        assert!(route.updated_at > original_updated_at);
    }

    #[test]
    fn test_route_point_serialization() {
        let point = RoutePoint {
            lat: 55.7558,
            lng: 37.6173,
            name: Some("Moscow".to_string()),
            note: Some("Historic center".to_string()),
            marker_color: Some("#8b5cf6".to_string()),
            marker_size: Some(32),
            preview_size: Some(52),
            preview_shape: Some("circle".to_string()),
            segment_mode: Some("auto".to_string()),
            segment_duration_minutes: Some(17),
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
        let json = r#"{"lat":55.0,"lng":37.0,"name":null,"segment_mode":null,"segment_duration_minutes":null,"photo":"data:image/png;base64,abc"}"#;
        let point: RoutePoint = serde_json::from_str(json).unwrap();

        assert!(point.note.is_none());
        assert!(point.marker_color.is_none());
        assert!(point.marker_size.is_none());
        assert!(point.preview_size.is_none());
        assert!(point.preview_shape.is_none());
        assert!(point.segment_duration_minutes.is_none());
        let photo = point.photo.unwrap();
        assert_eq!(photo.original, "data:image/png;base64,abc");
        assert_eq!(photo.status, PhotoStatus::Pending);
        assert!(photo.thumbnail_url.is_none());
    }

    #[test]
    fn test_backward_compat_null_photo() {
        let json = r#"{"lat":55.0,"lng":37.0,"name":null,"segment_mode":null,"segment_duration_minutes":null,"photo":null}"#;
        let point: RoutePoint = serde_json::from_str(json).unwrap();
        assert!(point.note.is_none());
        assert!(point.marker_color.is_none());
        assert!(point.marker_size.is_none());
        assert!(point.preview_size.is_none());
        assert!(point.preview_shape.is_none());
        assert!(point.segment_duration_minutes.is_none());
        assert!(point.photo.is_none());
    }

    #[test]
    fn test_photo_data_struct_deserialization() {
        let json = r##"{"lat":55.0,"lng":37.0,"name":null,"note":"Observation deck","marker_color":"#14b8a6","marker_size":28,"segment_mode":null,"segment_duration_minutes":12,"photo":{"original":"data:image/png;base64,abc","thumbnail_url":"/photos/thumb.jpg","status":"done"}}"##;
        let point: RoutePoint = serde_json::from_str(json).unwrap();

        assert_eq!(point.note, Some("Observation deck".to_string()));
        assert_eq!(point.marker_color, Some("#14b8a6".to_string()));
        assert_eq!(point.marker_size, Some(28));
        assert_eq!(point.segment_duration_minutes, Some(12));
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
