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
        sqlx::query(
            r#"
            INSERT INTO users (id, email, password_hash, created_at, updated_at, deleted_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#
        )
        .bind(user.id)
        .bind(&user.email)
        .bind(&user.password_hash)
        .bind(user.created_at)
        .bind(user.updated_at)
        .bind(user.deleted_at)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        Ok(())
    }

    async fn find_by_email(&self, email: &str) -> Result<Option<User>, RepositoryError> {
        let user = sqlx::query_as::<_, User>(
            r#"
            SELECT id, email, password_hash, created_at, updated_at, deleted_at
            FROM users
            WHERE email = $1
            "#
        )
        .bind(email)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        Ok(user)
    }

    async fn find_by_id(&self, id: uuid::Uuid) -> Result<Option<User>, RepositoryError> {
        let user = sqlx::query_as::<_, User>(
            r#"
            SELECT id, email, password_hash, created_at, updated_at, deleted_at
            FROM users
            WHERE id = $1
            "#
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        Ok(user)
    }
}

pub async fn create_pool(database_url: &str, max_connections: u32) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
    .max_connections(max_connections)
    .connect(database_url)
    .await
}
