use thiserror::Error;

#[derive(Error)]
pub enum RepositoryError {
    #[error("Database error: {0}")]
    DatabaseError(String),
    #[error("Connection error")]
    ConnectionError,
}
