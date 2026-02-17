use anyhow::{anyhow, Error};
use chrono::Utc;
use uuid::Uuid;

use crate::domain::user::{Role, User};
use crate::{domain, usecase::contracts::UserRepository};
use crate::delivery::contracts;
use crate::usecase::password::{hash_password, verify_password};
use crate::usecase::jwt::{JwtService, TokenType};


pub struct AuthUseCase<R>
where
    R: UserRepository,
{
    user_repository: R,
    jwt_service: JwtService,
}

impl<R> AuthUseCase<R>
where
    R: UserRepository
{
    pub fn new(user_repository: R) -> Self {
        // For now, use default JWT settings
        // TODO: Make this configurable
        let jwt_service = JwtService::new("default_secret_key".to_string(), 15, 7);

        Self {
            user_repository,
            jwt_service,
        }
    }

    pub fn with_jwt_service(user_repository: R, jwt_service: JwtService) -> Self {
        Self {
            user_repository,
            jwt_service,
        }
    }
}

impl<R> contracts::AuthUseCase for AuthUseCase<R>
where
    R: UserRepository,
{
    #[tracing::instrument(skip(self, password), fields(email = %email))]
    async fn register(&self, email: String, password: String) -> Result<domain::user::User, Error> {
        // Check if user already exists
        if let Some(_existing_user) = self.user_repository.find_by_email(&email).await? {
            return Err(anyhow!("User with this email already exists"));
        }

        // Hash password using the password utility module
        let password_hash = hash_password(&password)
            .map_err(|e| anyhow!("Failed to hash password: {}", e))?;

        let uuid = Uuid::new_v4();
        let now = Utc::now();

        let user = User {
            id: uuid,
            email: email,
            password_hash,
            name: None,
            avatar_url: None,
            role: Role::User,
            created_at: now,
            updated_at: now,
            deleted_at: None,
        };

        self.user_repository.create(&user).await?;

        Ok(user)
    }

    #[tracing::instrument(skip(self, password), fields(email = %email))]
    async fn login(&self, email: String, password: String) -> Result<crate::delivery::contracts::LoginResult, Error> {
        // Find user by email
        let user = self.user_repository.find_by_email(&email).await?
            .ok_or_else(|| anyhow!("Invalid credentials"))?;

        // Check if user is deleted
        if user.is_deleted() {
            return Err(anyhow!("User account is deleted"));
        }

        // Verify password
        let is_valid = verify_password(&password, &user.password_hash)
            .map_err(|e| anyhow!("Password verification failed: {}", e))?;

        if !is_valid {
            tracing::warn!("invalid password attempt");
            return Err(anyhow!("Invalid credentials"));
        }

        // Generate tokens
        let access_token = self.jwt_service.generate_access_token(user.id, user.email.clone())
            .map_err(|e| anyhow!("Failed to generate access token: {}", e))?;
        let refresh_token = self.jwt_service.generate_refresh_token(user.id, user.email.clone())
            .map_err(|e| anyhow!("Failed to generate refresh token: {}", e))?;

        Ok(crate::delivery::contracts::LoginResult {
            user,
            access_token,
            refresh_token,
        })
    }

    #[tracing::instrument(skip(self, refresh_token))]
    async fn refresh_token(&self, refresh_token: String) -> Result<String, Error> {
        // Validate the refresh token
        let claims = self.jwt_service.validate_token(&refresh_token)
            .map_err(|e| anyhow!("Invalid refresh token: {}", e))?;

        // Check that it's actually a refresh token
        if claims.token_type != TokenType::Refresh {
            return Err(anyhow!("Token is not a refresh token"));
        }

        // Parse user ID from claims
        let user_id = Uuid::parse_str(&claims.sub)
            .map_err(|e| anyhow!("Invalid user ID in token: {}", e))?;

        // Find user to ensure they still exist and aren't deleted
        let user = self.user_repository.find_by_id(user_id).await?
            .ok_or_else(|| anyhow!("User not found"))?;

        if user.is_deleted() {
            return Err(anyhow!("User account is deleted"));
        }

        // Generate new access token
        let new_access_token = self.jwt_service.generate_access_token(user.id, user.email)
            .map_err(|e| anyhow!("Failed to generate access token: {}", e))?;

        Ok(new_access_token)
    }

    async fn get_profile(&self, user_id: Uuid) -> Result<User, Error> {
        tracing::debug!(%user_id, "getting user profile");

        let user = self.user_repository.find_by_id(user_id).await?
            .ok_or_else(|| anyhow!("User not found"))?;

        if user.is_deleted() {
            return Err(anyhow!("User account is deleted"));
        }

        tracing::debug!(%user_id, "profile retrieved successfully");
        Ok(user)
    }

    async fn update_profile(&self, user_id: Uuid, name: Option<String>, avatar_url: Option<String>) -> Result<User, Error> {
        tracing::debug!(%user_id, ?name, ?avatar_url, "updating user profile");

        let mut user = self.user_repository.find_by_id(user_id).await?
            .ok_or_else(|| anyhow!("User not found"))?;

        if user.is_deleted() {
            return Err(anyhow!("User account is deleted"));
        }

        user.update_profile(name, avatar_url);
        self.user_repository.update(&user).await?;

        tracing::debug!(%user_id, "profile updated successfully");
        Ok(user)
    }

    #[tracing::instrument(skip(self, old_password, new_password), fields(user_id = %user_id))]
    async fn change_password(&self, user_id: Uuid, old_password: String, new_password: String) -> Result<(), Error> {
        tracing::debug!("changing user password");

        let mut user = self.user_repository.find_by_id(user_id).await?
            .ok_or_else(|| anyhow!("User not found"))?;

        if user.is_deleted() {
            return Err(anyhow!("User account is deleted"));
        }

        // Verify old password
        let is_valid = verify_password(&old_password, &user.password_hash)
            .map_err(|e| anyhow!("Password verification failed: {}", e))?;

        if !is_valid {
            tracing::warn!("old password verification failed");
            return Err(anyhow!("Invalid old password"));
        }

        // Hash new password
        let new_password_hash = hash_password(&new_password)
            .map_err(|e| anyhow!("Failed to hash password: {}", e))?;

        user.update_password(new_password_hash);
        self.user_repository.update(&user).await?;

        tracing::debug!(%user_id, "password changed successfully");
        Ok(())
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

        // Expect find_by_email to check for duplicate (returns None - no duplicate)
        mock_repo
            .expect_find_by_email()
            .times(1)
            .returning(|_| Ok(None));

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
        mock_repo1.expect_find_by_email().returning(|_| Ok(None));
        mock_repo1.expect_create().returning(|_| Ok(()));

        let mut mock_repo2 = MockUserRepository::new();
        mock_repo2.expect_find_by_email().returning(|_| Ok(None));
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
            .expect_find_by_email()
            .times(1)
            .returning(|_| Ok(None));

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
        mock_repo.expect_find_by_email().returning(|_| Ok(None));
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

    #[tokio::test]
    async fn test_register_fails_with_duplicate_email() {
        use crate::usecase::password::hash_password;

        let mut mock_repo = MockUserRepository::new();
        let email = "duplicate@example.com".to_string();

        // Mock returns existing user
        let existing_user = User {
            id: Uuid::new_v4(),
            email: email.clone(),
            password_hash: hash_password("somepassword").unwrap(),
            name: None,
            avatar_url: None,
            role: Role::User,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            deleted_at: None,
        };

        mock_repo
            .expect_find_by_email()
            .times(1)
            .returning(move |_| Ok(Some(existing_user.clone())));

        let auth_usecase = AuthUseCase::new(mock_repo);

        let result = auth_usecase
            .register(email, "newpassword".to_string())
            .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("already exists"));
    }

    // Login Tests
    #[tokio::test]
    async fn test_login_with_correct_credentials() {
        use crate::usecase::password::hash_password;

        let mut mock_repo = MockUserRepository::new();
        let email = "test@example.com".to_string();
        let password = "correct_password";
        let password_hash = hash_password(password).unwrap();

        let user = User {
            id: Uuid::new_v4(),
            email: email.clone(),
            password_hash: password_hash.clone(),
            name: None,
            avatar_url: None,
            role: Role::User,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            deleted_at: None,
        };
        let user_clone = user.clone();

        mock_repo
            .expect_find_by_email()
            .with(mockall::predicate::eq(email.clone()))
            .times(1)
            .returning(move |_| Ok(Some(user_clone.clone())));

        let auth_usecase = AuthUseCase::new(mock_repo);

        let result = auth_usecase
            .login(email.clone(), password.to_string())
            .await;

        assert!(result.is_ok());
        let login_result = result.unwrap();
        assert_eq!(login_result.user.email, email);
        assert!(!login_result.access_token.is_empty());
        assert!(!login_result.refresh_token.is_empty());
    }

    #[tokio::test]
    async fn test_login_with_incorrect_password() {
        use crate::usecase::password::hash_password;

        let mut mock_repo = MockUserRepository::new();
        let email = "test@example.com".to_string();
        let correct_password = "correct_password";
        let incorrect_password = "wrong_password";
        let password_hash = hash_password(correct_password).unwrap();

        let user = User {
            id: Uuid::new_v4(),
            email: email.clone(),
            password_hash,
            name: None,
            avatar_url: None,
            role: Role::User,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            deleted_at: None,
        };
        let user_clone = user.clone();

        mock_repo
            .expect_find_by_email()
            .with(mockall::predicate::eq(email.clone()))
            .times(1)
            .returning(move |_| Ok(Some(user_clone.clone())));

        let auth_usecase = AuthUseCase::new(mock_repo);

        let result = auth_usecase
            .login(email, incorrect_password.to_string())
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_login_with_nonexistent_user() {
        let mut mock_repo = MockUserRepository::new();
        let email = "nonexistent@example.com".to_string();

        mock_repo
            .expect_find_by_email()
            .with(mockall::predicate::eq(email.clone()))
            .times(1)
            .returning(|_| Ok(None));

        let auth_usecase = AuthUseCase::new(mock_repo);

        let result = auth_usecase
            .login(email, "password".to_string())
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_login_with_deleted_user() {
        use crate::usecase::password::hash_password;

        let mut mock_repo = MockUserRepository::new();
        let email = "deleted@example.com".to_string();
        let password = "password";
        let password_hash = hash_password(password).unwrap();

        let user = User {
            id: Uuid::new_v4(),
            email: email.clone(),
            password_hash,
            name: None,
            avatar_url: None,
            role: Role::User,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            deleted_at: Some(Utc::now()),
        };
        let user_clone = user.clone();

        mock_repo
            .expect_find_by_email()
            .with(mockall::predicate::eq(email.clone()))
            .times(1)
            .returning(move |_| Ok(Some(user_clone.clone())));

        let auth_usecase = AuthUseCase::new(mock_repo);

        let result = auth_usecase
            .login(email, password.to_string())
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_login_repository_error() {
        let mut mock_repo = MockUserRepository::new();
        let email = "test@example.com".to_string();

        mock_repo
            .expect_find_by_email()
            .with(mockall::predicate::eq(email.clone()))
            .times(1)
            .returning(|_| Err(crate::repository::errors::RepositoryError::DatabaseError("Connection failed".to_string())));

        let auth_usecase = AuthUseCase::new(mock_repo);

        let result = auth_usecase
            .login(email, "password".to_string())
            .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_login_returns_different_tokens() {
        use crate::usecase::password::hash_password;

        let mut mock_repo = MockUserRepository::new();
        let email = "test@example.com".to_string();
        let password = "password";
        let password_hash = hash_password(password).unwrap();

        let user = User {
            id: Uuid::new_v4(),
            email: email.clone(),
            password_hash,
            name: None,
            avatar_url: None,
            role: Role::User,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            deleted_at: None,
        };
        let user_clone = user.clone();

        mock_repo
            .expect_find_by_email()
            .with(mockall::predicate::eq(email.clone()))
            .times(1)
            .returning(move |_| Ok(Some(user_clone.clone())));

        let auth_usecase = AuthUseCase::new(mock_repo);

        let result = auth_usecase
            .login(email, password.to_string())
            .await;

        assert!(result.is_ok());
        let login_result = result.unwrap();
        assert_ne!(login_result.access_token, login_result.refresh_token);
    }

    // Refresh Token Tests
    #[tokio::test]
    async fn test_refresh_token_with_valid_token() {
        use crate::usecase::password::hash_password;
        use crate::usecase::jwt::JwtService;

        let email = "test@example.com".to_string();
        let password = "password";
        let password_hash = hash_password(password).unwrap();
        let user_id = Uuid::new_v4();

        let user = User {
            id: user_id,
            email: email.clone(),
            password_hash,
            name: None,
            avatar_url: None,
            role: Role::User,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            deleted_at: None,
        };
        let user_clone = user.clone();

        // Create a JWT service to generate a valid token
        let jwt_service = JwtService::new("test_secret".to_string(), 15, 7);
        let valid_refresh_token = jwt_service
            .generate_refresh_token(user_id, email.clone())
            .unwrap();

        // Setup mock to expect find_by_id call
        let mut mock_repo = MockUserRepository::new();
        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(user_id))
            .times(1)
            .returning(move |_| Ok(Some(user_clone.clone())));

        let auth_usecase = AuthUseCase::with_jwt_service(mock_repo, jwt_service);

        let result = auth_usecase.refresh_token(valid_refresh_token).await;

        // Should return a new access token
        assert!(result.is_ok());
        let new_access_token = result.unwrap();
        assert!(!new_access_token.is_empty());
    }

    #[tokio::test]
    async fn test_refresh_token_with_invalid_token() {
        let mock_repo = MockUserRepository::new();
        let auth_usecase = AuthUseCase::new(mock_repo);

        let invalid_token = "invalid.token".to_string();

        let result = auth_usecase.refresh_token(invalid_token).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_refresh_token_with_expired_token() {
        let mock_repo = MockUserRepository::new();
        let auth_usecase = AuthUseCase::new(mock_repo);

        let expired_token = "expired.refresh.token".to_string();

        let result = auth_usecase.refresh_token(expired_token).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_refresh_token_with_access_token() {
        let mock_repo = MockUserRepository::new();
        let auth_usecase = AuthUseCase::new(mock_repo);

        // Using an access token instead of refresh token should fail
        let access_token = "access.token.here".to_string();

        let result = auth_usecase.refresh_token(access_token).await;

        assert!(result.is_err());
    }

    // Profile Tests
    #[tokio::test]
    async fn test_get_profile_returns_user() {
        let mut mock_repo = MockUserRepository::new();
        let user_id = Uuid::new_v4();
        let user = User {
            id: user_id,
            email: "test@example.com".to_string(),
            password_hash: "hash".to_string(),
            name: Some("Test User".to_string()),
            avatar_url: Some("https://example.com/avatar.png".to_string()),
            role: Role::User,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            deleted_at: None,
        };
        let user_clone = user.clone();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(user_id))
            .times(1)
            .returning(move |_| Ok(Some(user_clone.clone())));

        let auth_usecase = AuthUseCase::new(mock_repo);

        let result = auth_usecase.get_profile(user_id).await;

        assert!(result.is_ok());
        let profile = result.unwrap();
        assert_eq!(profile.id, user_id);
        assert_eq!(profile.name, Some("Test User".to_string()));
    }

    #[tokio::test]
    async fn test_get_profile_user_not_found() {
        let mut mock_repo = MockUserRepository::new();
        let user_id = Uuid::new_v4();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(user_id))
            .times(1)
            .returning(|_| Ok(None));

        let auth_usecase = AuthUseCase::new(mock_repo);

        let result = auth_usecase.get_profile(user_id).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("User not found"));
    }

    #[tokio::test]
    async fn test_update_profile_success() {
        let mut mock_repo = MockUserRepository::new();
        let user_id = Uuid::new_v4();
        let user = User {
            id: user_id,
            email: "test@example.com".to_string(),
            password_hash: "hash".to_string(),
            name: None,
            avatar_url: None,
            role: Role::User,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            deleted_at: None,
        };
        let user_clone = user.clone();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(user_id))
            .times(1)
            .returning(move |_| Ok(Some(user_clone.clone())));

        mock_repo
            .expect_update()
            .times(1)
            .returning(|_| Ok(()));

        let auth_usecase = AuthUseCase::new(mock_repo);

        let result = auth_usecase.update_profile(
            user_id,
            Some("New Name".to_string()),
            Some("https://example.com/new-avatar.png".to_string()),
        ).await;

        assert!(result.is_ok());
        let updated_user = result.unwrap();
        assert_eq!(updated_user.name, Some("New Name".to_string()));
        assert_eq!(updated_user.avatar_url, Some("https://example.com/new-avatar.png".to_string()));
    }

    #[tokio::test]
    async fn test_change_password_success() {
        use crate::usecase::password::hash_password;

        let mut mock_repo = MockUserRepository::new();
        let user_id = Uuid::new_v4();
        let old_password = "old_password";
        let password_hash = hash_password(old_password).unwrap();

        let user = User {
            id: user_id,
            email: "test@example.com".to_string(),
            password_hash,
            name: None,
            avatar_url: None,
            role: Role::User,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            deleted_at: None,
        };
        let user_clone = user.clone();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(user_id))
            .times(1)
            .returning(move |_| Ok(Some(user_clone.clone())));

        mock_repo
            .expect_update()
            .times(1)
            .returning(|_| Ok(()));

        let auth_usecase = AuthUseCase::new(mock_repo);

        let result = auth_usecase.change_password(
            user_id,
            old_password.to_string(),
            "new_password".to_string(),
        ).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_change_password_invalid_old_password() {
        use crate::usecase::password::hash_password;

        let mut mock_repo = MockUserRepository::new();
        let user_id = Uuid::new_v4();
        let password_hash = hash_password("correct_password").unwrap();

        let user = User {
            id: user_id,
            email: "test@example.com".to_string(),
            password_hash,
            name: None,
            avatar_url: None,
            role: Role::User,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            deleted_at: None,
        };
        let user_clone = user.clone();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(user_id))
            .times(1)
            .returning(move |_| Ok(Some(user_clone.clone())));

        let auth_usecase = AuthUseCase::new(mock_repo);

        let result = auth_usecase.change_password(
            user_id,
            "wrong_password".to_string(),
            "new_password".to_string(),
        ).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Invalid old password"));
    }
}

