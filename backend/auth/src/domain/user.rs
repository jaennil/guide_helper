use uuid::Uuid;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub password_hash: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
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
            name: None,
            avatar_url: None,
            created_at: now,
            updated_at: now,
            deleted_at: None,
        }
    }

    pub fn update_profile(&mut self, name: Option<String>, avatar_url: Option<String>) {
        if name.is_some() {
            self.name = name;
        }
        if avatar_url.is_some() {
            self.avatar_url = avatar_url;
        }
        self.updated_at = Utc::now();
    }

    pub fn update_password(&mut self, password_hash: String) {
        self.password_hash = password_hash;
        self.updated_at = Utc::now();
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
        assert!(user.name.is_none());
        assert!(user.avatar_url.is_none());
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
            name: Some("Test User".to_string()),
            avatar_url: Some("https://example.com/avatar.png".to_string()),
            created_at: now,
            updated_at: now,
            deleted_at: None,
        };

        assert_eq!(user.id, id);
        assert_eq!(user.email, "user@test.com");
        assert_eq!(user.password_hash, "secure_hash");
        assert_eq!(user.name, Some("Test User".to_string()));
        assert_eq!(user.avatar_url, Some("https://example.com/avatar.png".to_string()));
    }

    #[test]
    fn test_update_profile() {
        let mut user = User::new("test@example.com".to_string(), "hash".to_string());
        let original_updated_at = user.updated_at;

        std::thread::sleep(std::time::Duration::from_millis(10));
        user.update_profile(Some("New Name".to_string()), Some("https://example.com/new-avatar.png".to_string()));

        assert_eq!(user.name, Some("New Name".to_string()));
        assert_eq!(user.avatar_url, Some("https://example.com/new-avatar.png".to_string()));
        assert!(user.updated_at > original_updated_at);
    }

    #[test]
    fn test_update_password() {
        let mut user = User::new("test@example.com".to_string(), "old_hash".to_string());
        let original_updated_at = user.updated_at;

        std::thread::sleep(std::time::Duration::from_millis(10));
        user.update_password("new_hash".to_string());

        assert_eq!(user.password_hash, "new_hash");
        assert!(user.updated_at > original_updated_at);
    }
}
