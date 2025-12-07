use crate::{domain::user::User, repository::errors::RepositoryError};
use uuid::Uuid;

#[cfg_attr(test, mockall::automock)]
pub trait UserRepository: Send + Sync {
    async fn create(&self, user: &User) -> Result<(), RepositoryError>;
    async fn find_by_email(&self, email: &str) -> Result<Option<User>, RepositoryError>;
    async fn find_by_id(&self, id: Uuid) -> Result<Option<User>, RepositoryError>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::user::User;

    #[tokio::test]
    async fn test_mock_repository_create() {
        let mut mock_repo = MockUserRepository::new();
        let user = User::new("test@example.com".to_string(), "hash".to_string());

        mock_repo
            .expect_create()
            .times(1)
            .returning(|_| Ok(()));

        let result = mock_repo.create(&user).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_mock_repository_find_by_email_returns_user() {
        let mut mock_repo = MockUserRepository::new();
        let email = "test@example.com";
        let expected_user = User::new(email.to_string(), "hash".to_string());
        let expected_user_clone = expected_user.clone();

        mock_repo
            .expect_find_by_email()
            .with(mockall::predicate::eq(email))
            .times(1)
            .returning(move |_| Ok(Some(expected_user_clone.clone())));

        let result = mock_repo.find_by_email(email).await;
        assert!(result.is_ok());
        let user = result.unwrap();
        assert!(user.is_some());
        assert_eq!(user.unwrap().email, email);
    }

    #[tokio::test]
    async fn test_mock_repository_find_by_email_returns_none() {
        let mut mock_repo = MockUserRepository::new();
        let email = "nonexistent@example.com";

        mock_repo
            .expect_find_by_email()
            .with(mockall::predicate::eq(email))
            .times(1)
            .returning(|_| Ok(None));

        let result = mock_repo.find_by_email(email).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_mock_repository_find_by_id_returns_user() {
        let mut mock_repo = MockUserRepository::new();
        let user = User::new("test@example.com".to_string(), "hash".to_string());
        let user_id = user.id;
        let user_clone = user.clone();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(user_id))
            .times(1)
            .returning(move |_| Ok(Some(user_clone.clone())));

        let result = mock_repo.find_by_id(user_id).await;
        assert!(result.is_ok());
        let found_user = result.unwrap();
        assert!(found_user.is_some());
        assert_eq!(found_user.unwrap().id, user_id);
    }

    #[tokio::test]
    async fn test_mock_repository_find_by_id_returns_none() {
        let mut mock_repo = MockUserRepository::new();
        let user_id = Uuid::new_v4();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(user_id))
            .times(1)
            .returning(|_| Ok(None));

        let result = mock_repo.find_by_id(user_id).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_mock_repository_find_by_email_error() {
        let mut mock_repo = MockUserRepository::new();
        let email = "test@example.com";

        mock_repo
            .expect_find_by_email()
            .with(mockall::predicate::eq(email))
            .times(1)
            .returning(|_| Err(RepositoryError::DatabaseError("Connection lost".to_string())));

        let result = mock_repo.find_by_email(email).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_mock_repository_find_by_id_error() {
        let mut mock_repo = MockUserRepository::new();
        let user_id = Uuid::new_v4();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(user_id))
            .times(1)
            .returning(|_| Err(RepositoryError::DatabaseError("Connection lost".to_string())));

        let result = mock_repo.find_by_id(user_id).await;
        assert!(result.is_err());
    }
}
