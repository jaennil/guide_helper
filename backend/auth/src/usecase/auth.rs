use anyhow::Error;

use crate::domain;

async fn register(email: String, password: String) -> Result<domain::user::User, Error> {
    let salt = rand::thread_rng().gen::<[u8; 32]>();
    let config = Config::default();
    let hash = argon2::hash_encoded(password.as_bytes(), &salt, &config).unwrap();

}
