use std::sync::Arc;

use axum::{extract::State, http::StatusCode, response::IntoResponse, Extension, Json};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::Validate;

use crate::delivery::contracts::AuthUseCase;
use crate::delivery::http::v1::middleware::AuthenticatedUser;
use crate::AppState;

#[derive(Serialize)]
pub struct ProfileResponse {
    pub id: Uuid,
    pub email: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Deserialize, Validate)]
pub struct UpdateProfileRequest {
    #[validate(length(max = 100))]
    pub name: Option<String>,
    #[validate(url)]
    pub avatar_url: Option<String>,
}

#[derive(Deserialize, Validate)]
pub struct ChangePasswordRequest {
    #[validate(length(min = 1))]
    pub old_password: String,
    #[validate(length(min = 8))]
    pub new_password: String,
}

pub async fn get_profile(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!(user_id = %user.user_id, "handling get profile request");

    match state.auth_usecase.get_profile(user.user_id).await {
        Ok(user_data) => {
            tracing::debug!(user_id = %user.user_id, "profile retrieved successfully");
            Ok((
                StatusCode::OK,
                Json(ProfileResponse {
                    id: user_data.id,
                    email: user_data.email,
                    name: user_data.name,
                    avatar_url: user_data.avatar_url,
                    created_at: user_data.created_at,
                }),
            ))
        }
        Err(e) => {
            tracing::error!(user_id = %user.user_id, error = %e, "failed to get profile");
            Err((StatusCode::NOT_FOUND, format!("Profile not found: {}", e)))
        }
    }
}

pub async fn update_profile(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(payload): Json<UpdateProfileRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!(user_id = %user.user_id, "handling update profile request");

    if let Err(validation_errors) = payload.validate() {
        tracing::warn!(user_id = %user.user_id, ?validation_errors, "validation failed");
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Validation error: {:?}", validation_errors),
        ));
    }

    match state
        .auth_usecase
        .update_profile(user.user_id, payload.name, payload.avatar_url)
        .await
    {
        Ok(user_data) => {
            tracing::debug!(user_id = %user.user_id, "profile updated successfully");
            Ok((
                StatusCode::OK,
                Json(ProfileResponse {
                    id: user_data.id,
                    email: user_data.email,
                    name: user_data.name,
                    avatar_url: user_data.avatar_url,
                    created_at: user_data.created_at,
                }),
            ))
        }
        Err(e) => {
            tracing::error!(user_id = %user.user_id, error = %e, "failed to update profile");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to update profile: {}", e),
            ))
        }
    }
}

pub async fn change_password(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(payload): Json<ChangePasswordRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tracing::debug!(user_id = %user.user_id, "handling change password request");

    if let Err(validation_errors) = payload.validate() {
        tracing::warn!(user_id = %user.user_id, ?validation_errors, "validation failed");
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Validation error: {:?}", validation_errors),
        ));
    }

    match state
        .auth_usecase
        .change_password(user.user_id, payload.old_password, payload.new_password)
        .await
    {
        Ok(()) => {
            tracing::debug!(user_id = %user.user_id, "password changed successfully");
            Ok((StatusCode::OK, Json(serde_json::json!({"message": "Password changed successfully"}))))
        }
        Err(e) => {
            let error_msg = e.to_string();
            if error_msg.contains("Invalid old password") {
                tracing::warn!(user_id = %user.user_id, "invalid old password provided");
                Err((StatusCode::BAD_REQUEST, "Invalid old password".to_string()))
            } else {
                tracing::error!(user_id = %user.user_id, error = %e, "failed to change password");
                Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to change password: {}", e),
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_update_profile_request_validation_valid() {
        let request = UpdateProfileRequest {
            name: Some("Test User".to_string()),
            avatar_url: Some("https://example.com/avatar.png".to_string()),
        };

        assert!(request.validate().is_ok());
    }

    #[test]
    fn test_update_profile_request_validation_name_too_long() {
        let request = UpdateProfileRequest {
            name: Some("a".repeat(101)),
            avatar_url: None,
        };

        let result = request.validate();
        assert!(result.is_err());
    }

    #[test]
    fn test_update_profile_request_validation_invalid_url() {
        let request = UpdateProfileRequest {
            name: None,
            avatar_url: Some("not-a-url".to_string()),
        };

        let result = request.validate();
        assert!(result.is_err());
    }

    #[test]
    fn test_change_password_request_validation_valid() {
        let request = ChangePasswordRequest {
            old_password: "old_password".to_string(),
            new_password: "new_password_123".to_string(),
        };

        assert!(request.validate().is_ok());
    }

    #[test]
    fn test_change_password_request_validation_empty_old_password() {
        let request = ChangePasswordRequest {
            old_password: "".to_string(),
            new_password: "new_password_123".to_string(),
        };

        let result = request.validate();
        assert!(result.is_err());
    }

    #[test]
    fn test_change_password_request_validation_short_new_password() {
        let request = ChangePasswordRequest {
            old_password: "old_password".to_string(),
            new_password: "short".to_string(),
        };

        let result = request.validate();
        assert!(result.is_err());
    }

    #[test]
    fn test_profile_response_serialization() {
        let response = ProfileResponse {
            id: Uuid::new_v4(),
            email: "test@example.com".to_string(),
            name: Some("Test User".to_string()),
            avatar_url: Some("https://example.com/avatar.png".to_string()),
            created_at: Utc::now(),
        };

        let json = serde_json::to_string(&response);
        assert!(json.is_ok());
        let json_str = json.unwrap();
        assert!(json_str.contains("test@example.com"));
        assert!(json_str.contains("Test User"));
    }
}
