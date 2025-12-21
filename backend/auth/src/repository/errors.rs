use thiserror::Error;

#[derive(Debug, Error)]
pub enum RepositoryError {
    #[error("Database error: {0}")]
    DatabaseError(String),
    #[error("Connection error")]
    #[allow(dead_code)]
    ConnectionError,
}
