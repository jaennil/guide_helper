use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::route::Route;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhotoProcessTask {
    pub route_id: Uuid,
    pub user_id: Uuid,
    pub point_indices: Vec<usize>,
}

impl PhotoProcessTask {
    pub fn from_route(route: &Route) -> Option<Self> {
        let indices: Vec<usize> = route
            .points
            .iter()
            .enumerate()
            .filter_map(|(i, point)| {
                if let Some(ref photo) = point.photo {
                    if photo.original.starts_with("data:") {
                        return Some(i);
                    }
                }
                None
            })
            .collect();

        if indices.is_empty() {
            return None;
        }

        Some(Self {
            route_id: route.id,
            user_id: route.user_id,
            point_indices: indices,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::route::{PhotoData, PhotoStatus, Route, RoutePoint};

    #[test]
    fn test_from_route_with_base64_photos() {
        let route = Route {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            name: "test".to_string(),
            points: vec![
                RoutePoint {
                    lat: 55.0,
                    lng: 37.0,
                    name: None,
                    segment_mode: None,
                    photo: Some(PhotoData {
                        original: "data:image/png;base64,abc".to_string(),
                        thumbnail_url: None,
                        status: PhotoStatus::Pending,
                    }),
                },
                RoutePoint {
                    lat: 56.0,
                    lng: 38.0,
                    name: None,
                    segment_mode: None,
                    photo: None,
                },
                RoutePoint {
                    lat: 57.0,
                    lng: 39.0,
                    name: None,
                    segment_mode: None,
                    photo: Some(PhotoData {
                        original: "data:image/jpeg;base64,xyz".to_string(),
                        thumbnail_url: None,
                        status: PhotoStatus::Pending,
                    }),
                },
            ],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            share_token: None,
            category_ids: vec![],
        };

        let task = PhotoProcessTask::from_route(&route).unwrap();
        assert_eq!(task.route_id, route.id);
        assert_eq!(task.point_indices, vec![0, 2]);
    }

    #[test]
    fn test_from_route_no_photos() {
        let route = Route {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            name: "test".to_string(),
            points: vec![RoutePoint {
                lat: 55.0,
                lng: 37.0,
                name: None,
                segment_mode: None,
                photo: None,
            }],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            share_token: None,
            category_ids: vec![],
        };

        assert!(PhotoProcessTask::from_route(&route).is_none());
    }

    #[test]
    fn test_from_route_already_processed_url() {
        let route = Route {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            name: "test".to_string(),
            points: vec![RoutePoint {
                lat: 55.0,
                lng: 37.0,
                name: None,
                segment_mode: None,
                photo: Some(PhotoData {
                    original: "/photos/user/route/photo_0.jpg".to_string(),
                    thumbnail_url: Some("/photos/user/route/thumb_0.jpg".to_string()),
                    status: PhotoStatus::Done,
                }),
            }],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            share_token: None,
            category_ids: vec![],
        };

        assert!(PhotoProcessTask::from_route(&route).is_none());
    }
}
