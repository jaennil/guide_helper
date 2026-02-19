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

use crate::delivery::http::v1::admin::require_admin;
use crate::delivery::http::v1::middleware::AuthenticatedUser;
use crate::usecase::error::UsecaseError;
use crate::AppState;

#[derive(Serialize)]
pub struct CategoryResponse {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Deserialize, Validate)]
pub struct CreateCategoryRequest {
    #[validate(length(min = 1, max = 100))]
    pub name: String,
}

#[derive(Deserialize, Validate)]
pub struct UpdateCategoryRequest {
    #[validate(length(min = 1, max = 100))]
    pub name: String,
}

#[tracing::instrument(skip(state))]
pub async fn list_categories(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, UsecaseError> {
    tracing::debug!("handling list categories request");

    let categories = state.categories_usecase.list_categories().await?;

    let response: Vec<CategoryResponse> = categories
        .into_iter()
        .map(|c| CategoryResponse {
            id: c.id,
            name: c.name,
            created_at: c.created_at,
        })
        .collect();

    tracing::debug!(count = response.len(), "categories listed successfully");
    Ok((StatusCode::OK, Json(response)))
}

#[tracing::instrument(skip(state, payload), fields(user_id = %user.user_id))]
pub async fn create_category(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(payload): Json<CreateCategoryRequest>,
) -> Result<impl IntoResponse, UsecaseError> {
    require_admin(&user)?;
    tracing::debug!("handling create category request");

    if let Err(validation_errors) = payload.validate() {
        tracing::warn!(?validation_errors, "validation failed");
        return Err(UsecaseError::Validation(format!("{:?}", validation_errors)));
    }

    let category = state.categories_usecase.create_category(payload.name).await?;

    tracing::debug!(category_id = %category.id, "category created successfully");
    Ok((
        StatusCode::CREATED,
        Json(CategoryResponse {
            id: category.id,
            name: category.name,
            created_at: category.created_at,
        }),
    ))
}

#[tracing::instrument(skip(state, payload), fields(user_id = %user.user_id, category_id = %id))]
pub async fn update_category(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateCategoryRequest>,
) -> Result<impl IntoResponse, UsecaseError> {
    require_admin(&user)?;
    tracing::debug!("handling update category request");

    if let Err(validation_errors) = payload.validate() {
        tracing::warn!(?validation_errors, "validation failed");
        return Err(UsecaseError::Validation(format!("{:?}", validation_errors)));
    }

    state.categories_usecase.update_category(id, payload.name).await?;

    tracing::debug!(category_id = %id, "category updated successfully");
    Ok(StatusCode::NO_CONTENT)
}

#[tracing::instrument(skip(state), fields(user_id = %user.user_id, category_id = %id))]
pub async fn delete_category(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, UsecaseError> {
    require_admin(&user)?;
    tracing::debug!("handling delete category request");

    state.categories_usecase.delete_category(id).await?;

    tracing::debug!(category_id = %id, "category deleted successfully");
    Ok(StatusCode::NO_CONTENT)
}
