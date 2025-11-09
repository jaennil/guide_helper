use anyhow::Error;

use crate::domain;

pub trait AuthUseCase {
    async fn register(&self, email: String, password: String) -> Result<domain::user::User, Error>;
}
