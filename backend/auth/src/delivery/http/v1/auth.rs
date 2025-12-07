use std::sync::Arc;

use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use validator::Validate;

use crate::delivery::{contracts::AuthUseCase};
use crate::AppState;

#[derive(Deserialize, Validate)]
pub struct RegisterRequest {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_request_valid_email_and_password() {
        let request = RegisterRequest {
            email: "test@example.com".to_string(),
            password: "password123".to_string(),
        };

        assert!(request.validate().is_ok());
    }

    #[test]
    fn test_register_request_invalid_email() {
        let request = RegisterRequest {
            email: "not-an-email".to_string(),
            password: "password123".to_string(),
        };

        let result = request.validate();
        assert!(result.is_err());
        let errors = result.unwrap_err();
        assert!(errors.field_errors().contains_key("email"));
    }

    #[test]
    fn test_register_request_password_too_short() {
        let request = RegisterRequest {
            email: "test@example.com".to_string(),
            password: "short".to_string(),
        };

        let result = request.validate();
        assert!(result.is_err());
        let errors = result.unwrap_err();
        assert!(errors.field_errors().contains_key("password"));
    }

    #[test]
    fn test_register_request_exact_min_password_length() {
        let request = RegisterRequest {
            email: "test@example.com".to_string(),
            password: "12345678".to_string(),
        };

        assert!(request.validate().is_ok());
    }

    #[test]
    fn test_register_request_empty_email() {
        let request = RegisterRequest {
            email: "".to_string(),
            password: "password123".to_string(),
        };

        let result = request.validate();
        assert!(result.is_err());
    }

    #[test]
    fn test_register_request_multiple_validation_errors() {
        let request = RegisterRequest {
            email: "invalid".to_string(),
            password: "short".to_string(),
        };

        let result = request.validate();
        assert!(result.is_err());
        let errors = result.unwrap_err();
        assert!(errors.field_errors().contains_key("email"));
        assert!(errors.field_errors().contains_key("password"));
    }

    #[test]
    fn test_register_request_email_with_special_characters() {
        let request = RegisterRequest {
            email: "user+test@example.co.uk".to_string(),
            password: "password123".to_string(),
        };

        assert!(request.validate().is_ok());
    }

    #[test]
    fn test_register_request_long_password() {
        let request = RegisterRequest {
            email: "test@example.com".to_string(),
            password: "a".repeat(100),
        };

        assert!(request.validate().is_ok());
    }
}
