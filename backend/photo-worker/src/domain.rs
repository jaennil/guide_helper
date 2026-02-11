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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhotoProcessTask {
    pub route_id: Uuid,
    pub user_id: Uuid,
    pub point_indices: Vec<usize>,
}
