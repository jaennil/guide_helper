use std::sync::Arc;

use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use uuid::Uuid;

use crate::{usecase::jwt::TokenType, AppState};

#[derive(Clone, Debug)]
pub struct AuthenticatedUser {
    pub user_id: Uuid,
    pub email: String,
}

pub async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    mut request: Request,
    next: Next,
) -> Result<Response, (StatusCode, String)> {
    let auth_header = request
        .headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok());

    let token = match auth_header {
        Some(header) if header.starts_with("Bearer ") => {
            header.strip_prefix("Bearer ").unwrap()
        }
        _ => {
            tracing::warn!("missing or invalid authorization header");
            return Err((
                StatusCode::UNAUTHORIZED,
                "Missing or invalid Authorization header".to_string(),
            ));
        }
    };

    let claims = match state.jwt_service.validate_token(token) {
        Ok(claims) => claims,
        Err(e) => {
            tracing::warn!(?e, "invalid token");
            return Err((StatusCode::UNAUTHORIZED, format!("Invalid token: {}", e)));
        }
    };

    // Ensure it's an access token, not a refresh token
    if claims.token_type != TokenType::Access {
        tracing::warn!("attempted to use non-access token for authentication");
        return Err((
            StatusCode::UNAUTHORIZED,
            "Invalid token type".to_string(),
        ));
    }

    let user_id = Uuid::parse_str(&claims.sub).map_err(|e| {
        tracing::error!(?e, "failed to parse user_id from token");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Invalid user ID in token".to_string(),
        )
    })?;

    let authenticated_user = AuthenticatedUser {
        user_id,
        email: claims.email,
    };

    tracing::debug!(?authenticated_user, "user authenticated successfully");
    request.extensions_mut().insert(authenticated_user);

    Ok(next.run(request).await)
}
