use std::sync::Arc;

use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use validator::Validate;

use crate::delivery::{contracts::AuthUseCase};
use crate::AppState;

#[derive(Deserialize, Validate)]
struct RegisterRequest {
    #[validate(email)]
    email: String,
    #[validate(length(min = 8))]
    password: String,
}

#[derive(Serialize)]
struct AuthResponse {
    access_token: String,
    refresh_token: String,
    token_type: String,
}

pub async fn register(State(state): State<Arc<AppState>>, Json(payload): Json<RegisterRequest>) -> Result<impl IntoResponse, (StatusCode, String)>
{
    if let Err(validation_errors) = payload.validate() {
        return Err((StatusCode::BAD_REQUEST, format!("validation error: {:?}", validation_errors)));
    }

    let user = state.auth_usecase.register(payload.email, payload.password).await.unwrap();
    tracing::debug!(?user);
    // let (access, refresh) = usecase::auth::login(payload.email, &payload.password).await?;

    Ok((StatusCode::CREATED, Json(AuthResponse {
        access_token: "access".to_string(),
        refresh_token: "refresh".to_string(),
        token_type: "Bearer".to_string(),
    })))
}
