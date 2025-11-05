use crate::{domain::user::User, repository::errors::RepositoryError};

pub trait UserRepository {
    async fn create(&self, user: &User) -> Result<(), RepositoryError>;
}
