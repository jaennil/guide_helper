use sqlx::{postgres::PgPoolOptions, PgPool};

use crate::{domain::user::User, repository::errors::RepositoryError, usecase::contracts::UserRepository};

pub struct PostgresUserRepository {
    pool: PgPool,
}

impl PostgresUserRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl UserRepository for PostgresUserRepository {
    async fn create(&self, user: &User) -> Result<(), RepositoryError> {
        sqlx::query!(
            r#"
            INSERT INTO users (id, email, password_hash, created_at, updated_at, deleted_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
            user.id,
            user.email,
            user.password_hash,
            user.created_at,
            user.updated_at,
            user.deleted_at
        )
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        Ok(())
    }
}

pub async fn create_pool(database_url: &str, max_connections: u32) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
    .max_connections(max_connections)
    .connect(database_url)
    .await
}
