use axum::{http::StatusCode, response::IntoResponse};
use thiserror::Error;

use crate::repository::errors::RepositoryError;

#[derive(Debug, Error)]
pub enum UsecaseError {
    #[error("{0} not found")]
    NotFound(String),

    #[error("{0}")]
    Forbidden(String),

    #[error("{0}")]
    Validation(String),

    #[error("{0}")]
    Unavailable(String),

    #[error("{0}")]
    RateLimited(String),

    #[error("{0}")]
    Internal(String),
}

impl From<RepositoryError> for UsecaseError {
    fn from(e: RepositoryError) -> Self {
        match e {
            RepositoryError::NotFound => UsecaseError::NotFound("Resource".to_string()),
            RepositoryError::DatabaseError(msg) => UsecaseError::Internal(msg),
        }
    }
}

impl From<anyhow::Error> for UsecaseError {
    fn from(e: anyhow::Error) -> Self {
        UsecaseError::Internal(e.to_string())
    }
}

impl IntoResponse for UsecaseError {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            UsecaseError::NotFound(_) => StatusCode::NOT_FOUND,
            UsecaseError::Forbidden(_) => StatusCode::FORBIDDEN,
            UsecaseError::Validation(_) => StatusCode::BAD_REQUEST,
            UsecaseError::Unavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            UsecaseError::RateLimited(_) => StatusCode::TOO_MANY_REQUESTS,
            UsecaseError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        match &self {
            UsecaseError::Internal(_) => {
                tracing::error!(error = %self, "internal error");
            }
            UsecaseError::NotFound(_) => {
                tracing::warn!(error = %self, "resource not found");
            }
            UsecaseError::Forbidden(_) => {
                tracing::warn!(error = %self, "forbidden");
            }
            _ => {
                tracing::debug!(error = %self);
            }
        }

        (status, self.to_string()).into_response()
    }
}
