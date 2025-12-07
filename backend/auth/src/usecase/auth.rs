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

        self.user_repository.create(&user).await?;

        Ok(user)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usecase::contracts::MockUserRepository;
    use crate::delivery::contracts::AuthUseCase as AuthUseCaseTrait;

    #[tokio::test]
    async fn test_register_creates_user_with_hashed_password() {
        let mut mock_repo = MockUserRepository::new();

        mock_repo
            .expect_create()
            .times(1)
            .returning(|_| Ok(()));

        let auth_usecase = AuthUseCase::new(mock_repo);
        let email = "test@example.com".to_string();
        let password = "securepassword123".to_string();

        let result = auth_usecase.register(email.clone(), password.clone()).await;

        assert!(result.is_ok());
        let user = result.unwrap();
        assert_eq!(user.email, email);
        assert_ne!(user.password_hash, password);
        assert!(user.password_hash.starts_with("$argon2"));
        assert!(user.deleted_at.is_none());
    }

    #[tokio::test]
    async fn test_register_generates_unique_ids() {
        let mut mock_repo1 = MockUserRepository::new();
        mock_repo1.expect_create().returning(|_| Ok(()));

        let mut mock_repo2 = MockUserRepository::new();
        mock_repo2.expect_create().returning(|_| Ok(()));

        let auth_usecase1 = AuthUseCase::new(mock_repo1);
        let auth_usecase2 = AuthUseCase::new(mock_repo2);

        let user1 = auth_usecase1
            .register("user1@test.com".to_string(), "password".to_string())
            .await
            .unwrap();
        let user2 = auth_usecase2
            .register("user2@test.com".to_string(), "password".to_string())
            .await
            .unwrap();

        assert_ne!(user1.id, user2.id);
    }

    #[tokio::test]
    async fn test_register_fails_when_repository_fails() {
        let mut mock_repo = MockUserRepository::new();

        mock_repo
            .expect_create()
            .times(1)
            .returning(|_| Err(crate::repository::errors::RepositoryError::DatabaseError("Connection failed".to_string())));

        let auth_usecase = AuthUseCase::new(mock_repo);

        let result = auth_usecase
            .register("test@example.com".to_string(), "password".to_string())
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_register_sets_timestamps() {
        let mut mock_repo = MockUserRepository::new();
        mock_repo.expect_create().returning(|_| Ok(()));

        let auth_usecase = AuthUseCase::new(mock_repo);
        let before = Utc::now();

        let user = auth_usecase
            .register("test@example.com".to_string(), "password".to_string())
            .await
            .unwrap();

        let after = Utc::now();

        assert!(user.created_at >= before && user.created_at <= after);
        assert!(user.updated_at >= before && user.updated_at <= after);
        assert_eq!(user.created_at, user.updated_at);
    }
}

