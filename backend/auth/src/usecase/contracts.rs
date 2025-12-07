use crate::{domain::user::User, repository::errors::RepositoryError};

#[cfg_attr(test, mockall::automock)]
pub trait UserRepository: Send + Sync {
    async fn create(&self, user: &User) -> Result<(), RepositoryError>;
}
