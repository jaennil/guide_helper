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

#[derive(Deserialize, Validate)]
pub struct LoginRequest {
    #[validate(email)]
    email: String,
    #[validate(length(min = 1))]
    password: String,
}

#[derive(Deserialize, Validate)]
pub struct RefreshTokenRequest {
    #[validate(length(min = 1))]
    refresh_token: String,
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

    match state.auth_usecase.register(payload.email.clone(), payload.password.clone()).await {
        Ok(user) => {
            tracing::debug!(?user, "User registered successfully");

            // Log the user in to get tokens
            match state.auth_usecase.login(payload.email, payload.password).await {
                Ok(login_result) => {
                    Ok((StatusCode::CREATED, Json(AuthResponse {
                        access_token: login_result.access_token,
                        refresh_token: login_result.refresh_token,
                        token_type: "Bearer".to_string(),
                    })))
                }
                Err(e) => {
                    tracing::error!("Failed to generate tokens after registration: {}", e);
                    Err((StatusCode::INTERNAL_SERVER_ERROR, "Registration succeeded but token generation failed".to_string()))
                }
            }
        }
        Err(e) => {
            tracing::error!("Registration failed: {}", e);
            Err((StatusCode::BAD_REQUEST, format!("Registration failed: {}", e)))
        }
    }
}

pub async fn login(State(state): State<Arc<AppState>>, Json(payload): Json<LoginRequest>) -> Result<impl IntoResponse, (StatusCode, String)>
{
    if let Err(validation_errors) = payload.validate() {
        return Err((StatusCode::BAD_REQUEST, format!("validation error: {:?}", validation_errors)));
    }

    match state.auth_usecase.login(payload.email, payload.password).await {
        Ok(login_result) => {
            tracing::debug!(?login_result.user);
            Ok((StatusCode::OK, Json(AuthResponse {
                access_token: login_result.access_token,
                refresh_token: login_result.refresh_token,
                token_type: "Bearer".to_string(),
            })))
        }
        Err(e) => {
            tracing::error!("Login failed: {}", e);
            Err((StatusCode::UNAUTHORIZED, "Invalid credentials".to_string()))
        }
    }
}

pub async fn refresh_token(State(state): State<Arc<AppState>>, Json(payload): Json<RefreshTokenRequest>) -> Result<impl IntoResponse, (StatusCode, String)>
{
    if let Err(validation_errors) = payload.validate() {
        return Err((StatusCode::BAD_REQUEST, format!("validation error: {:?}", validation_errors)));
    }

    match state.auth_usecase.refresh_token(payload.refresh_token).await {
        Ok(new_access_token) => {
            Ok((StatusCode::OK, Json(serde_json::json!({
                "access_token": new_access_token,
                "token_type": "Bearer"
            }))))
        }
        Err(e) => {
            tracing::error!("Token refresh failed: {}", e);
            Err((StatusCode::UNAUTHORIZED, "Invalid or expired token".to_string()))
        }
    }
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

    // Login Request Tests
    #[test]
    fn test_login_request_valid_credentials() {
        let request = LoginRequest {
            email: "test@example.com".to_string(),
            password: "password".to_string(),
        };

        assert!(request.validate().is_ok());
    }

    #[test]
    fn test_login_request_invalid_email() {
        let request = LoginRequest {
            email: "not-an-email".to_string(),
            password: "password".to_string(),
        };

        let result = request.validate();
        assert!(result.is_err());
        let errors = result.unwrap_err();
        assert!(errors.field_errors().contains_key("email"));
    }

    #[test]
    fn test_login_request_empty_password() {
        let request = LoginRequest {
            email: "test@example.com".to_string(),
            password: "".to_string(),
        };

        let result = request.validate();
        assert!(result.is_err());
        let errors = result.unwrap_err();
        assert!(errors.field_errors().contains_key("password"));
    }

    #[test]
    fn test_login_request_short_password_allowed() {
        // Login should allow short passwords (no min length requirement beyond 1)
        let request = LoginRequest {
            email: "test@example.com".to_string(),
            password: "a".to_string(),
        };

        assert!(request.validate().is_ok());
    }

    #[test]
    fn test_login_request_empty_email() {
        let request = LoginRequest {
            email: "".to_string(),
            password: "password".to_string(),
        };

        let result = request.validate();
        assert!(result.is_err());
    }

    #[test]
    fn test_login_request_multiple_errors() {
        let request = LoginRequest {
            email: "invalid".to_string(),
            password: "".to_string(),
        };

        let result = request.validate();
        assert!(result.is_err());
        let errors = result.unwrap_err();
        assert!(errors.field_errors().contains_key("email"));
        assert!(errors.field_errors().contains_key("password"));
    }

    // Refresh Token Request Tests
    #[test]
    fn test_refresh_token_request_valid() {
        let request = RefreshTokenRequest {
            refresh_token: "valid.jwt.token".to_string(),
        };

        assert!(request.validate().is_ok());
    }

    #[test]
    fn test_refresh_token_request_empty_token() {
        let request = RefreshTokenRequest {
            refresh_token: "".to_string(),
        };

        let result = request.validate();
        assert!(result.is_err());
        let errors = result.unwrap_err();
        assert!(errors.field_errors().contains_key("refresh_token"));
    }

    #[test]
    fn test_refresh_token_request_long_token() {
        let request = RefreshTokenRequest {
            refresh_token: "a".repeat(1000),
        };

        assert!(request.validate().is_ok());
    }
}
