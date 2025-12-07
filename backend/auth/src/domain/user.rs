use uuid::Uuid;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, PartialEq)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub password_hash: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

impl User {
    pub fn new(email: String, password_hash: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            email,
            password_hash,
            created_at: now,
            updated_at: now,
            deleted_at: None,
        }
    }

    pub fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }

    pub fn soft_delete(&mut self) {
        self.deleted_at = Some(Utc::now());
        self.updated_at = Utc::now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_user_creation() {
        let email = "test@example.com".to_string();
        let password_hash = "hashed_password".to_string();

        let user = User::new(email.clone(), password_hash.clone());

        assert_eq!(user.email, email);
        assert_eq!(user.password_hash, password_hash);
        assert_eq!(user.created_at, user.updated_at);
        assert!(user.deleted_at.is_none());
        assert!(!user.is_deleted());
    }

    #[test]
    fn test_user_is_not_deleted_initially() {
        let user = User::new("test@example.com".to_string(), "hash".to_string());

        assert!(!user.is_deleted());
        assert!(user.deleted_at.is_none());
    }

    #[test]
    fn test_user_soft_delete() {
        let mut user = User::new("test@example.com".to_string(), "hash".to_string());
        let original_created_at = user.created_at;

        user.soft_delete();

        assert!(user.is_deleted());
        assert!(user.deleted_at.is_some());
        assert_eq!(user.created_at, original_created_at);
        assert!(user.updated_at > original_created_at);
    }

    #[test]
    fn test_user_fields() {
        let id = Uuid::new_v4();
        let now = Utc::now();

        let user = User {
            id,
            email: "user@test.com".to_string(),
            password_hash: "secure_hash".to_string(),
            created_at: now,
            updated_at: now,
            deleted_at: None,
        };

        assert_eq!(user.id, id);
        assert_eq!(user.email, "user@test.com");
        assert_eq!(user.password_hash, "secure_hash");
    }
}
