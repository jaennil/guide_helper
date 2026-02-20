use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use axum_extra::extract::Multipart;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::Validate;

use crate::delivery::http::v1::middleware::AuthenticatedUser;
use crate::domain::route::{Route as DomainRoute, RoutePoint};
use crate::usecase::error::UsecaseError;
use crate::usecase::geojson_import::{parse_geojson, ImportError};
use crate::usecase::photo_tasks::PhotoProcessTask;
use crate::AppState;

#[derive(Serialize)]
pub struct RouteResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub points: Vec<RoutePoint>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub share_token: Option<String>,
    pub category_ids: Vec<Uuid>,
}

#[derive(Deserialize, Validate)]
pub struct CreateRouteRequest {
    #[validate(length(min = 1, max = 200))]
    pub name: String,
    #[validate(length(min = 1))]
    pub points: Vec<RoutePoint>,
    #[serde(default)]
    pub category_ids: Vec<Uuid>,
}

#[derive(Deserialize, Validate)]
pub struct UpdateRouteRequest {
    #[validate(length(min = 1, max = 200))]
    pub name: Option<String>,
    pub points: Option<Vec<RoutePoint>>,
    pub category_ids: Option<Vec<Uuid>>,
}

fn route_to_response(r: DomainRoute) -> RouteResponse {
    RouteResponse {
        id: r.id,
        user_id: r.user_id,
        name: r.name,
        points: r.points,
        created_at: r.created_at,
        updated_at: r.updated_at,
        share_token: r.share_token.map(|t| t.to_string()),
        category_ids: r.category_ids,
    }
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id))]
pub async fn list_routes(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!("handling list routes request");

    let routes = state.routes_usecase.get_user_routes(user.user_id).await?;
    let response: Vec<RouteResponse> = routes.into_iter().map(route_to_response).collect();

    tracing::debug!(user_id = %user.user_id, count = response.len(), "routes listed successfully");
    Ok((StatusCode::OK, Json(response)))
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id))]
pub async fn get_route(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!(user_id = %user.user_id, %route_id, "handling get route request");

    let route = state.routes_usecase.get_route(user.user_id, route_id).await?;

    tracing::debug!(%route_id, "route retrieved successfully");
    Ok((StatusCode::OK, Json(route_to_response(route))))
}

#[tracing::instrument(skip(state, payload), fields(user_id = %user.user_id))]
pub async fn create_route(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(payload): Json<CreateRouteRequest>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!("handling create route request");

    if let Err(validation_errors) = payload.validate() {
        tracing::warn!(user_id = %user.user_id, ?validation_errors, "validation failed");
        return Err(UsecaseError::Validation(format!("{:?}", validation_errors)));
    }

    let route = state
        .routes_usecase
        .create_route(user.user_id, payload.name, payload.points, payload.category_ids)
        .await?;

    tracing::debug!(route_id = %route.id, "route created successfully");
    publish_photo_task(&state.nats_client, &route).await;
    Ok((StatusCode::CREATED, Json(route_to_response(route))))
}

#[tracing::instrument(skip(state, payload), fields(user_id = %user.user_id))]
pub async fn update_route(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(route_id): Path<Uuid>,
    Json(payload): Json<UpdateRouteRequest>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!(%route_id, "handling update route request");

    if let Err(validation_errors) = payload.validate() {
        tracing::warn!(user_id = %user.user_id, ?validation_errors, "validation failed");
        return Err(UsecaseError::Validation(format!("{:?}", validation_errors)));
    }

    let route = state
        .routes_usecase
        .update_route(user.user_id, route_id, payload.name, payload.points, payload.category_ids)
        .await?;

    tracing::debug!(%route_id, "route updated successfully");
    publish_photo_task(&state.nats_client, &route).await;
    Ok((StatusCode::OK, Json(route_to_response(route))))
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id))]
pub async fn delete_route(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!(%route_id, "handling delete route request");

    state
        .routes_usecase
        .delete_route(user.user_id, route_id, &user.role)
        .await?;

    tracing::debug!(%route_id, "route deleted successfully");
    Ok(StatusCode::NO_CONTENT)
}

#[tracing::instrument(skip(state, multipart), fields(user_id = %user.user_id))]
pub async fn import_route_from_geojson(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!("handling import route from GeoJSON request");

    let mut file_content: Option<String> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| UsecaseError::Validation(format!("Failed to read multipart: {}", e)))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        tracing::debug!(field_name = %field_name, "processing multipart field");

        if field_name == "file" {
            let bytes = field.bytes().await.map_err(|e| {
                UsecaseError::Validation(format!("Failed to read file: {}", e))
            })?;

            file_content = Some(String::from_utf8(bytes.to_vec()).map_err(|_| {
                UsecaseError::Validation("File must be valid UTF-8".to_string())
            })?);

            tracing::debug!(content_len = file_content.as_ref().map(|c| c.len()), "read file content");
            break;
        }
    }

    let content = file_content.ok_or_else(|| {
        tracing::warn!("no 'file' field in multipart request");
        UsecaseError::Validation("Missing 'file' field in multipart request".to_string())
    })?;

    let (name, points) = parse_geojson(&content).map_err(|e| {
        tracing::warn!(error = %e, "failed to parse GeoJSON");
        match &e {
            ImportError::InvalidGeoJson(_)
            | ImportError::MissingRouteName
            | ImportError::EmptyRoute
            | ImportError::UnsupportedGeometry => {
                UsecaseError::Validation(e.to_string())
            }
        }
    })?;

    tracing::info!(
        user_id = %user.user_id,
        route_name = %name,
        point_count = points.len(),
        "parsed GeoJSON successfully, creating route"
    );

    let route = state
        .routes_usecase
        .create_route(user.user_id, name, points, vec![])
        .await?;

    tracing::info!(route_id = %route.id, "route imported successfully from GeoJSON");
    publish_photo_task(&state.nats_client, &route).await;
    Ok((StatusCode::CREATED, Json(route_to_response(route))))
}

#[derive(Serialize)]
pub struct ShareResponse {
    pub share_token: String,
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id))]
pub async fn enable_share(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!(%route_id, "handling enable share request");

    let token = state
        .routes_usecase
        .enable_sharing(user.user_id, route_id)
        .await?;

    tracing::info!(%route_id, %token, "sharing enabled");
    Ok((
        StatusCode::OK,
        Json(ShareResponse {
            share_token: token.to_string(),
        }),
    ))
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id))]
pub async fn disable_share(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(route_id): Path<Uuid>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!(%route_id, "handling disable share request");

    state
        .routes_usecase
        .disable_sharing(user.user_id, route_id)
        .await?;

    tracing::info!(%route_id, "sharing disabled");
    Ok(StatusCode::NO_CONTENT)
}

#[tracing::instrument(skip(state))]
pub async fn get_shared_route(
    State(state): State<Arc<AppState>>,
    Path(token): Path<Uuid>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!(%token, "handling get shared route request");

    let route = state.routes_usecase.get_shared_route(token).await?;

    tracing::debug!(route_id = %route.id, "shared route retrieved");
    Ok((StatusCode::OK, Json(route_to_response(route))))
}

#[derive(Debug, Deserialize)]
pub struct ExploreQuery {
    pub search: Option<String>,
    pub category_id: Option<Uuid>,
    pub sort: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Serialize)]
pub struct ExploreRouteResponse {
    pub id: Uuid,
    pub name: String,
    pub points_count: i64,
    pub created_at: DateTime<Utc>,
    pub share_token: String,
    pub likes_count: i64,
    pub avg_rating: f64,
    pub ratings_count: i64,
    pub category_ids: Vec<Uuid>,
}

#[derive(Serialize)]
pub struct ExploreResponse {
    pub routes: Vec<ExploreRouteResponse>,
    pub total: i64,
}

#[tracing::instrument(skip(state))]
pub async fn explore_routes(
    State(state): State<Arc<AppState>>,
    Query(params): Query<ExploreQuery>,
) -> Result<impl IntoResponse, UsecaseError> {
    let search = params.search.filter(|s| !s.is_empty());
    let category_id = params.category_id;
    let sort = params.sort.as_deref().unwrap_or("newest");
    let limit = params.limit.unwrap_or(20).min(50).max(1);
    let offset = params.offset.unwrap_or(0).max(0);

    tracing::debug!(?search, ?category_id, %sort, %limit, %offset, "handling explore routes request");

    let (rows, total) = state
        .routes_usecase
        .explore_routes(search, category_id, sort, limit, offset)
        .await?;

    let routes: Vec<ExploreRouteResponse> = rows
        .into_iter()
        .map(|r| ExploreRouteResponse {
            id: r.id,
            name: r.name,
            points_count: r.points_count,
            created_at: r.created_at,
            share_token: r.share_token.to_string(),
            likes_count: r.likes_count,
            avg_rating: r.avg_rating,
            ratings_count: r.ratings_count,
            category_ids: r.category_ids,
        })
        .collect();

    tracing::debug!(count = routes.len(), total, "explore routes listed");
    Ok((StatusCode::OK, Json(ExploreResponse { routes, total })))
}

async fn publish_photo_task(nats_client: &Option<async_nats::Client>, route: &DomainRoute) {
    if let Some(client) = nats_client {
        if let Some(task) = PhotoProcessTask::from_route(route) {
            match serde_json::to_vec(&task) {
                Ok(payload) => {
                    let jetstream = async_nats::jetstream::new(client.clone());
                    match jetstream
                        .publish("photos.process", payload.into())
                        .await
                    {
                        Ok(ack_future) => {
                            match ack_future.await {
                                Ok(_) => {
                                    tracing::info!(
                                        route_id = %task.route_id,
                                        point_count = task.point_indices.len(),
                                        "published photo processing task to NATS"
                                    );
                                }
                                Err(e) => {
                                    tracing::error!(
                                        route_id = %task.route_id,
                                        error = %e,
                                        "failed to get NATS publish ack"
                                    );
                                }
                            }
                        }
                        Err(e) => {
                            tracing::error!(
                                route_id = %task.route_id,
                                error = %e,
                                "failed to publish photo task to NATS"
                            );
                        }
                    }
                }
                Err(e) => {
                    tracing::error!(
                        route_id = %task.route_id,
                        error = %e,
                        "failed to serialize photo task"
                    );
                }
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
                segment_mode: None,
                photo: None,
            }],
            category_ids: vec![],
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
                segment_mode: None,
                photo: None,
            }],
            category_ids: vec![],
        };

        assert!(request.validate().is_err());
    }

    #[test]
    fn test_create_route_request_validation_empty_points() {
        let request = CreateRouteRequest {
            name: "Test".to_string(),
            points: vec![],
            category_ids: vec![],
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
                segment_mode: Some("auto".to_string()),
                photo: None,
            }],
            created_at: Utc::now(),
            updated_at: Utc::now(),
            share_token: None,
            category_ids: vec![],
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(!json.contains("share_token"));

        let response_with_token = RouteResponse {
            share_token: Some(Uuid::new_v4().to_string()),
            ..response
        };
        let json_with_token = serde_json::to_string(&response_with_token).unwrap();
        assert!(json_with_token.contains("share_token"));
    }
}
