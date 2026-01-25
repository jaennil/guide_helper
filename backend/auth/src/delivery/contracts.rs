use anyhow::Error;
use uuid::Uuid;

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
    async fn get_profile(&self, user_id: Uuid) -> Result<domain::user::User, Error>;
    async fn update_profile(&self, user_id: Uuid, name: Option<String>, avatar_url: Option<String>) -> Result<domain::user::User, Error>;
    async fn change_password(&self, user_id: Uuid, old_password: String, new_password: String) -> Result<(), Error>;
}
