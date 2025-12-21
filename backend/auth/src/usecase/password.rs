use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PasswordError {
    #[error("Failed to hash password: {0}")]
    HashError(String),
    #[error("Failed to verify password: {0}")]
    VerifyError(String),
    #[error("Invalid password")]
    #[allow(dead_code)]
    InvalidPassword,
}

pub fn hash_password(password: &str) -> Result<String, PasswordError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();

    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| PasswordError::HashError(e.to_string()))
}

pub fn verify_password(password: &str, password_hash: &str) -> Result<bool, PasswordError> {
    let parsed_hash = PasswordHash::new(password_hash)
        .map_err(|e| PasswordError::VerifyError(e.to_string()))?;

    let argon2 = Argon2::default();

    match argon2.verify_password(password.as_bytes(), &parsed_hash) {
        Ok(_) => Ok(true),
        Err(argon2::password_hash::Error::Password) => Ok(false),
        Err(e) => Err(PasswordError::VerifyError(e.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_password_returns_argon2_hash() {
        let password = "test_password_123";
        let result = hash_password(password);

        assert!(result.is_ok());
        let hash = result.unwrap();
        assert!(hash.starts_with("$argon2"));
        assert_ne!(hash, password);
    }

    #[test]
    fn test_hash_password_generates_different_hashes() {
        let password = "same_password";
        let hash1 = hash_password(password).unwrap();
        let hash2 = hash_password(password).unwrap();

        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_verify_password_with_correct_password() {
        let password = "correct_password";
        let hash = hash_password(password).unwrap();

        let result = verify_password(password, &hash);

        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[test]
    fn test_verify_password_with_incorrect_password() {
        let correct_password = "correct_password";
        let incorrect_password = "wrong_password";
        let hash = hash_password(correct_password).unwrap();

        let result = verify_password(incorrect_password, &hash);

        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_verify_password_with_invalid_hash() {
        let password = "test_password";
        let invalid_hash = "not_a_valid_hash";

        let result = verify_password(password, invalid_hash);

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PasswordError::VerifyError(_)));
    }

    #[test]
    fn test_verify_password_with_empty_password() {
        let password = "";
        let hash = hash_password(password).unwrap();

        let result = verify_password(password, &hash);

        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[test]
    fn test_hash_password_with_special_characters() {
        let password = "p@ssw0rd!#$%^&*()";
        let result = hash_password(password);

        assert!(result.is_ok());
        let hash = result.unwrap();

        let verify_result = verify_password(password, &hash);
        assert!(verify_result.is_ok());
        assert!(verify_result.unwrap());
    }

    #[test]
    fn test_hash_password_with_unicode() {
        let password = "密码🔒";
        let result = hash_password(password);

        assert!(result.is_ok());
        let hash = result.unwrap();

        let verify_result = verify_password(password, &hash);
        assert!(verify_result.is_ok());
        assert!(verify_result.unwrap());
    }

    #[test]
    fn test_hash_password_with_long_password() {
        let password = "a".repeat(1000);
        let result = hash_password(&password);

        assert!(result.is_ok());
        let hash = result.unwrap();

        let verify_result = verify_password(&password, &hash);
        assert!(verify_result.is_ok());
        assert!(verify_result.unwrap());
    }
}
