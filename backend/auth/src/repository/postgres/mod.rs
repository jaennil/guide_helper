use sqlx::{postgres::PgPoolOptions, PgPool, Row};

use crate::{domain::user::User, repository::errors::RepositoryError, usecase::contracts::{RoleCount, UserRepository, UserRow}};

pub struct PostgresUserRepository {
    pool: PgPool,
}

impl PostgresUserRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl UserRepository for PostgresUserRepository {
    #[tracing::instrument(skip(self, user), fields(user_id = %user.id, email = %user.email))]
    async fn create(&self, user: &User) -> Result<(), RepositoryError> {
        sqlx::query(
            r#"
            INSERT INTO users (id, email, password_hash, name, avatar_url, role, created_at, updated_at, deleted_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            "#
        )
        .bind(user.id)
        .bind(&user.email)
        .bind(&user.password_hash)
        .bind(&user.name)
        .bind(&user.avatar_url)
        .bind(&user.role)
        .bind(user.created_at)
        .bind(user.updated_at)
        .bind(user.deleted_at)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        Ok(())
    }

    #[tracing::instrument(skip(self), fields(email = %email))]
    async fn find_by_email(&self, email: &str) -> Result<Option<User>, RepositoryError> {
        let user = sqlx::query_as::<_, User>(
            r#"
            SELECT id, email, password_hash, name, avatar_url, role, created_at, updated_at, deleted_at
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

    #[tracing::instrument(skip(self), fields(user_id = %id))]
    async fn find_by_id(&self, id: uuid::Uuid) -> Result<Option<User>, RepositoryError> {
        let user = sqlx::query_as::<_, User>(
            r#"
            SELECT id, email, password_hash, name, avatar_url, role, created_at, updated_at, deleted_at
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

    #[tracing::instrument(skip(self, user), fields(user_id = %user.id))]
    async fn update(&self, user: &User) -> Result<(), RepositoryError> {
        sqlx::query(
            r#"
            UPDATE users
            SET email = $2, password_hash = $3, name = $4, avatar_url = $5, role = $6, updated_at = $7, deleted_at = $8
            WHERE id = $1
            "#
        )
        .bind(user.id)
        .bind(&user.email)
        .bind(&user.password_hash)
        .bind(&user.name)
        .bind(&user.avatar_url)
        .bind(&user.role)
        .bind(user.updated_at)
        .bind(user.deleted_at)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        Ok(())
    }

    #[tracing::instrument(skip(self), fields(%limit, %offset))]
    async fn find_all_users(&self, limit: i64, offset: i64, search: Option<String>) -> Result<Vec<UserRow>, RepositoryError> {
        let rows = if let Some(ref q) = search {
            let pattern = format!("%{}%", q);
            sqlx::query(
                r#"
                SELECT id, email, name, role, created_at
                FROM users
                WHERE deleted_at IS NULL AND (email ILIKE $1 OR name ILIKE $1)
                ORDER BY created_at DESC
                LIMIT $2 OFFSET $3
                "#
            )
            .bind(&pattern)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
        } else {
            sqlx::query(
                r#"
                SELECT id, email, name, role, created_at
                FROM users
                WHERE deleted_at IS NULL
                ORDER BY created_at DESC
                LIMIT $1 OFFSET $2
                "#
            )
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
        }
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        let users = rows
            .iter()
            .map(|row| UserRow {
                id: row.get("id"),
                email: row.get("email"),
                name: row.get("name"),
                role: row.get("role"),
                created_at: row.get("created_at"),
            })
            .collect();

        Ok(users)
    }

    #[tracing::instrument(skip(self))]
    async fn count_users(&self, search: Option<String>) -> Result<i64, RepositoryError> {
        let count: i64 = if let Some(ref q) = search {
            let pattern = format!("%{}%", q);
            sqlx::query_scalar(
                r#"SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND (email ILIKE $1 OR name ILIKE $1)"#
            )
            .bind(&pattern)
            .fetch_one(&self.pool)
            .await
        } else {
            sqlx::query_scalar(
                r#"SELECT COUNT(*) FROM users WHERE deleted_at IS NULL"#
            )
            .fetch_one(&self.pool)
            .await
        }
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        Ok(count)
    }

    #[tracing::instrument(skip(self))]
    async fn count_users_by_role(&self) -> Result<Vec<RoleCount>, RepositoryError> {
        let rows = sqlx::query(
            r#"SELECT role, COUNT(*) as count FROM users WHERE deleted_at IS NULL GROUP BY role"#
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        let counts = rows
            .iter()
            .map(|row| RoleCount {
                role: row.get("role"),
                count: row.get("count"),
            })
            .collect();

        Ok(counts)
    }

    #[tracing::instrument(skip(self), fields(%user_id, %role))]
    async fn update_role(&self, user_id: uuid::Uuid, role: &str) -> Result<(), RepositoryError> {
        let result = sqlx::query(
            r#"UPDATE users SET role = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL"#
        )
        .bind(user_id)
        .bind(role)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(RepositoryError::DatabaseError("User not found".to_string()));
        }

        Ok(())
    }
}

pub async fn create_pool(database_url: &str, max_connections: u32) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
    .max_connections(max_connections)
    .connect(database_url)
    .await
}
