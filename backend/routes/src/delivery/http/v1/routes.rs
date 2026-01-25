use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::Validate;

use crate::delivery::http::v1::middleware::AuthenticatedUser;
use crate::domain::route::RoutePoint;
use crate::AppState;

#[derive(Serialize)]
pub struct RouteResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub points: Vec<RoutePoint>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Deserialize, Validate)]
pub struct CreateRouteRequest {
    #[validate(length(min = 1, max = 200))]
    pub name: String,
    #[validate(length(min = 1))]
    pub points: Vec<RoutePoint>,
}

#[derive(Deserialize, Validate)]
pub struct UpdateRouteRequest {
    #[validate(length(min = 1, max = 200))]
    pub name: Option<String>,
    pub points: Option<Vec<RoutePoint>>,
}

pub async fn list_routes(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!(user_id = %user.user_id, "handling list routes request");

    match state.routes_usecase.get_user_routes(user.user_id).await {
        Ok(routes) => {
            let response: Vec<RouteResponse> = routes
                .into_iter()
                .map(|r| RouteResponse {
                    id: r.id,
                    user_id: r.user_id,
                    name: r.name,
                    points: r.points,
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                })
                .collect();
            tracing::debug!(user_id = %user.user_id, count = response.len(), "routes listed successfully");
            Ok((StatusCode::OK, Json(response)))
        }
        Err(e) => {
            tracing::error!(user_id = %user.user_id, error = %e, "failed to list routes");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to list routes: {}", e),
            ))
        }
    }
}

pub async fn get_route(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!(user_id = %user.user_id, %route_id, "handling get route request");

    match state.routes_usecase.get_route(user.user_id, route_id).await {
        Ok(route) => {
            tracing::debug!(%route_id, "route retrieved successfully");
            Ok((
                StatusCode::OK,
                Json(RouteResponse {
                    id: route.id,
                    user_id: route.user_id,
                    name: route.name,
                    points: route.points,
                    created_at: route.created_at,
                    updated_at: route.updated_at,
                }),
            ))
        }
        Err(e) => {
            let error_msg = e.to_string();
            if error_msg.contains("not found") {
                tracing::warn!(%route_id, "route not found");
                Err((StatusCode::NOT_FOUND, "Route not found".to_string()))
            } else {
                tracing::error!(%route_id, error = %e, "failed to get route");
                Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to get route: {}", e),
                ))
            }
        }
    }
}

pub async fn create_route(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(payload): Json<CreateRouteRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!(user_id = %user.user_id, "handling create route request");

    if let Err(validation_errors) = payload.validate() {
        tracing::warn!(user_id = %user.user_id, ?validation_errors, "validation failed");
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Validation error: {:?}", validation_errors),
        ));
    }

    match state
        .routes_usecase
        .create_route(user.user_id, payload.name, payload.points)
        .await
    {
        Ok(route) => {
            tracing::debug!(route_id = %route.id, "route created successfully");
            Ok((
                StatusCode::CREATED,
                Json(RouteResponse {
                    id: route.id,
                    user_id: route.user_id,
                    name: route.name,
                    points: route.points,
                    created_at: route.created_at,
                    updated_at: route.updated_at,
                }),
            ))
        }
        Err(e) => {
            tracing::error!(user_id = %user.user_id, error = %e, "failed to create route");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create route: {}", e),
            ))
        }
    }
}

pub async fn update_route(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(route_id): Path<Uuid>,
    Json(payload): Json<UpdateRouteRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!(user_id = %user.user_id, %route_id, "handling update route request");

    if let Err(validation_errors) = payload.validate() {
        tracing::warn!(user_id = %user.user_id, ?validation_errors, "validation failed");
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Validation error: {:?}", validation_errors),
        ));
    }

    match state
        .routes_usecase
        .update_route(user.user_id, route_id, payload.name, payload.points)
        .await
    {
        Ok(route) => {
            tracing::debug!(%route_id, "route updated successfully");
            Ok((
                StatusCode::OK,
                Json(RouteResponse {
                    id: route.id,
                    user_id: route.user_id,
                    name: route.name,
                    points: route.points,
                    created_at: route.created_at,
                    updated_at: route.updated_at,
                }),
            ))
        }
        Err(e) => {
            let error_msg = e.to_string();
            if error_msg.contains("not found") {
                tracing::warn!(%route_id, "route not found");
                Err((StatusCode::NOT_FOUND, "Route not found".to_string()))
            } else {
                tracing::error!(%route_id, error = %e, "failed to update route");
                Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to update route: {}", e),
                ))
            }
        }
    }
}

pub async fn delete_route(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!(user_id = %user.user_id, %route_id, "handling delete route request");

    match state
        .routes_usecase
        .delete_route(user.user_id, route_id)
        .await
    {
        Ok(()) => {
            tracing::debug!(%route_id, "route deleted successfully");
            Ok(StatusCode::NO_CONTENT)
        }
        Err(e) => {
            let error_msg = e.to_string();
            if error_msg.contains("not found") {
                tracing::warn!(%route_id, "route not found");
                Err((StatusCode::NOT_FOUND, "Route not found".to_string()))
            } else {
                tracing::error!(%route_id, error = %e, "failed to delete route");
                Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to delete route: {}", e),
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_route_request_validation_valid() {
        let request = CreateRouteRequest {
            name: "Test Route".to_string(),
            points: vec![RoutePoint {
                lat: 55.7558,
                lng: 37.6173,
                name: None,
            }],
        };

        assert!(request.validate().is_ok());
    }

    #[test]
    fn test_create_route_request_validation_empty_name() {
        let request = CreateRouteRequest {
            name: "".to_string(),
            points: vec![RoutePoint {
                lat: 55.7558,
                lng: 37.6173,
                name: None,
            }],
        };

        assert!(request.validate().is_err());
    }

    #[test]
    fn test_create_route_request_validation_empty_points() {
        let request = CreateRouteRequest {
            name: "Test".to_string(),
            points: vec![],
        };

        assert!(request.validate().is_err());
    }

    #[test]
    fn test_route_response_serialization() {
        let response = RouteResponse {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            name: "Test Route".to_string(),
            points: vec![RoutePoint {
                lat: 55.7558,
                lng: 37.6173,
                name: Some("Moscow".to_string()),
            }],
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let json = serde_json::to_string(&response);
        assert!(json.is_ok());
    }
}
