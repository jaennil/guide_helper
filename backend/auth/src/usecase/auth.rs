use argon2::PasswordHasher;
use anyhow::Error;
use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::SaltString;
use argon2::{Argon2 };
use chrono::Utc;
use uuid::Uuid;

use crate::domain::user::User;
use crate::{domain, usecase::contracts::UserRepository};
use crate::delivery::contracts;


pub struct AuthUseCase<R>
where
    R: UserRepository,
{
    user_repository: R,
}

impl<R> AuthUseCase<R>
where
    R: UserRepository
{
    pub fn new(user_repository: R) -> Self {
        Self {
            user_repository
        }
    }
}

impl<R> contracts::AuthUseCase for AuthUseCase<R>
where
    R: UserRepository,
{
    async fn register(&self, email: String, password: String) -> Result<domain::user::User, Error> {
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let hash = argon2.hash_password(password.as_bytes(), &salt).unwrap().to_string();

        let uuid = Uuid::new_v4();
        let now = Utc::now();

        let user = User {
            id: uuid,
            email: email,
            password_hash: hash,
            created_at: now,
            updated_at: now,
            deleted_at: None,
        };

        self.user_repository.create(&user).await;

        Ok(user)
    }
}

