use anyhow::Error;
use axum::{http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use validator::Validate;

use crate::usecase;

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

pub async fn register(Json(payload): Json<RegisterRequest>) -> Result<impl IntoResponse, Error> {
    payload.validate()?;

    let user = usecase::auth::register(payload.email, payload.password).await?;
    let (access, refresh) = usecase::auth::login(payload.email, &payload.password).await?;

    Ok((StatusCode::CREATED, Json(AuthResponse {
        access_token: access,
        refresh_token: refresh,
        token_type: "Bearer".to_string(),
    })))
}
