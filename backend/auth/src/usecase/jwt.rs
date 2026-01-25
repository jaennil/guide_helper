use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum JwtError {
    #[error("Failed to generate token: {0}")]
    TokenGenerationError(String),
    #[error("Failed to validate token: {0}")]
    TokenValidationError(String),
    #[error("Token expired")]
    TokenExpired,
    #[error("Invalid token")]
    #[allow(dead_code)]
    InvalidToken,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct Claims {
    pub sub: String,      // Subject (user id)
    pub email: String,    // User email
    pub exp: i64,         // Expiration time
    pub iat: i64,         // Issued at
    pub token_type: TokenType,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum TokenType {
    Access,
    Refresh,
}

#[derive(Clone)]
pub struct JwtService {
    secret: String,
    access_token_duration: Duration,
    refresh_token_duration: Duration,
}

impl JwtService {
    pub fn new(secret: String, access_minutes: i64, refresh_days: i64) -> Self {
        Self {
            secret,
            access_token_duration: Duration::minutes(access_minutes),
            refresh_token_duration: Duration::days(refresh_days),
        }
    }

    pub fn generate_access_token(&self, user_id: Uuid, email: String) -> Result<String, JwtError> {
        self.generate_token(user_id, email, TokenType::Access, self.access_token_duration)
    }

    pub fn generate_refresh_token(&self, user_id: Uuid, email: String) -> Result<String, JwtError> {
        self.generate_token(user_id, email, TokenType::Refresh, self.refresh_token_duration)
    }

    fn generate_token(
        &self,
        user_id: Uuid,
        email: String,
        token_type: TokenType,
        duration: Duration,
    ) -> Result<String, JwtError> {
        let now = Utc::now();
        let exp = (now + duration).timestamp();
        let iat = now.timestamp();

        let claims = Claims {
            sub: user_id.to_string(),
            email,
            exp,
            iat,
            token_type,
        };

        jsonwebtoken::encode(
            &jsonwebtoken::Header::default(),
            &claims,
            &jsonwebtoken::EncodingKey::from_secret(self.secret.as_bytes()),
        )
        .map_err(|e| JwtError::TokenGenerationError(e.to_string()))
    }

    pub fn validate_token(&self, token: &str) -> Result<Claims, JwtError> {
        let mut validation = jsonwebtoken::Validation::default();
        validation.validate_exp = true;

        let token_data = jsonwebtoken::decode::<Claims>(
            token,
            &jsonwebtoken::DecodingKey::from_secret(self.secret.as_bytes()),
            &validation,
        )
        .map_err(|e| match e.kind() {
            jsonwebtoken::errors::ErrorKind::ExpiredSignature => JwtError::TokenExpired,
            _ => JwtError::TokenValidationError(e.to_string()),
        })?;

        Ok(token_data.claims)
    }

    #[allow(dead_code)]
    pub fn decode_token_without_validation(&self, token: &str) -> Result<Claims, JwtError> {
        let mut validation = jsonwebtoken::Validation::default();
        validation.validate_exp = false;
        validation.insecure_disable_signature_validation();

        let token_data = jsonwebtoken::decode::<Claims>(
            token,
            &jsonwebtoken::DecodingKey::from_secret(self.secret.as_bytes()),
            &validation,
        )
        .map_err(|_e| JwtError::InvalidToken)?;

        Ok(token_data.claims)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_jwt_service() -> JwtService {
        JwtService::new("test_secret_key_123".to_string(), 15, 7)
    }

    #[test]
    fn test_jwt_service_creation() {
        let service = JwtService::new("secret".to_string(), 30, 14);
        assert_eq!(service.secret, "secret");
        assert_eq!(service.access_token_duration, Duration::minutes(30));
        assert_eq!(service.refresh_token_duration, Duration::days(14));
    }

    #[test]
    fn test_generate_access_token_returns_valid_token() {
        let service = create_test_jwt_service();
        let user_id = Uuid::new_v4();
        let email = "test@example.com".to_string();

        let result = service.generate_access_token(user_id, email.clone());

        assert!(result.is_ok());
        let token = result.unwrap();
        assert!(!token.is_empty());
        assert!(token.contains('.'));
    }

    #[test]
    fn test_generate_refresh_token_returns_valid_token() {
        let service = create_test_jwt_service();
        let user_id = Uuid::new_v4();
        let email = "test@example.com".to_string();

        let result = service.generate_refresh_token(user_id, email.clone());

        assert!(result.is_ok());
        let token = result.unwrap();
        assert!(!token.is_empty());
        assert!(token.contains('.'));
    }

    #[test]
    fn test_generated_tokens_are_different() {
        let service = create_test_jwt_service();
        let user_id = Uuid::new_v4();
        let email = "test@example.com".to_string();

        let access_token = service.generate_access_token(user_id, email.clone()).unwrap();
        let refresh_token = service.generate_refresh_token(user_id, email.clone()).unwrap();

        assert_ne!(access_token, refresh_token);
    }

    #[test]
    fn test_validate_access_token_with_valid_token() {
        let service = create_test_jwt_service();
        let user_id = Uuid::new_v4();
        let email = "test@example.com".to_string();

        let token = service.generate_access_token(user_id, email.clone()).unwrap();
        let result = service.validate_token(&token);

        assert!(result.is_ok());
        let claims = result.unwrap();
        assert_eq!(claims.sub, user_id.to_string());
        assert_eq!(claims.email, email);
        assert_eq!(claims.token_type, TokenType::Access);
    }

    #[test]
    fn test_validate_refresh_token_with_valid_token() {
        let service = create_test_jwt_service();
        let user_id = Uuid::new_v4();
        let email = "test@example.com".to_string();

        let token = service.generate_refresh_token(user_id, email.clone()).unwrap();
        let result = service.validate_token(&token);

        assert!(result.is_ok());
        let claims = result.unwrap();
        assert_eq!(claims.sub, user_id.to_string());
        assert_eq!(claims.email, email);
        assert_eq!(claims.token_type, TokenType::Refresh);
    }

    #[test]
    fn test_validate_token_with_invalid_token() {
        let service = create_test_jwt_service();
        let invalid_token = "invalid.token.here";

        let result = service.validate_token(invalid_token);

        assert!(result.is_err());
    }

    #[test]
    fn test_validate_token_with_wrong_secret() {
        let service1 = JwtService::new("secret1".to_string(), 15, 7);
        let service2 = JwtService::new("secret2".to_string(), 15, 7);

        let user_id = Uuid::new_v4();
        let email = "test@example.com".to_string();

        let token = service1.generate_access_token(user_id, email).unwrap();
        let result = service2.validate_token(&token);

        assert!(result.is_err());
    }

    #[test]
    fn test_token_contains_expiration_time() {
        let service = create_test_jwt_service();
        let user_id = Uuid::new_v4();
        let email = "test@example.com".to_string();

        let token = service.generate_access_token(user_id, email).unwrap();
        let claims = service.validate_token(&token).unwrap();

        assert!(claims.exp > Utc::now().timestamp());
        assert!(claims.iat <= Utc::now().timestamp());
    }

    #[test]
    fn test_access_token_expiration_duration() {
        let service = create_test_jwt_service();
        let user_id = Uuid::new_v4();
        let email = "test@example.com".to_string();

        let token = service.generate_access_token(user_id, email).unwrap();
        let claims = service.validate_token(&token).unwrap();

        let expected_exp = Utc::now() + Duration::minutes(15);
        let exp_diff = (claims.exp - expected_exp.timestamp()).abs();

        assert!(exp_diff < 5);
    }

    #[test]
    fn test_refresh_token_expiration_duration() {
        let service = create_test_jwt_service();
        let user_id = Uuid::new_v4();
        let email = "test@example.com".to_string();

        let token = service.generate_refresh_token(user_id, email).unwrap();
        let claims = service.validate_token(&token).unwrap();

        let expected_exp = Utc::now() + Duration::days(7);
        let exp_diff = (claims.exp - expected_exp.timestamp()).abs();

        assert!(exp_diff < 5);
    }

    #[test]
    fn test_token_with_empty_email() {
        let service = create_test_jwt_service();
        let user_id = Uuid::new_v4();
        let email = "".to_string();

        let result = service.generate_access_token(user_id, email);

        assert!(result.is_ok());
    }

    #[test]
    fn test_different_user_ids_generate_different_tokens() {
        let service = create_test_jwt_service();
        let user_id1 = Uuid::new_v4();
        let user_id2 = Uuid::new_v4();
        let email = "test@example.com".to_string();

        let token1 = service.generate_access_token(user_id1, email.clone()).unwrap();
        let token2 = service.generate_access_token(user_id2, email.clone()).unwrap();

        assert_ne!(token1, token2);
    }
}
