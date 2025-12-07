use anyhow::Error;

use crate::domain;

pub struct LoginResult {
    pub user: domain::user::User,
    pub access_token: String,
    pub refresh_token: String,
}

pub trait AuthUseCase {
    async fn register(&self, email: String, password: String) -> Result<domain::user::User, Error>;
    async fn login(&self, email: String, password: String) -> Result<LoginResult, Error>;
    async fn refresh_token(&self, refresh_token: String) -> Result<String, Error>;
}
