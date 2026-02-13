use sqlx::{postgres::PgPoolOptions, PgPool};
use uuid::Uuid;

use crate::{
    domain::comment::Comment,
    domain::route::Route,
    repository::errors::RepositoryError,
    usecase::contracts::{CommentRepository, RouteRepository},
};

pub struct PostgresRouteRepository {
    pool: PgPool,
}

impl PostgresRouteRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl RouteRepository for PostgresRouteRepository {
    #[tracing::instrument(skip(self, route), fields(route_id = %route.id, user_id = %route.user_id))]
    async fn create(&self, route: &Route) -> Result<(), RepositoryError> {
        tracing::debug!("creating route");

        sqlx::query(
            r#"
            INSERT INTO routes (id, user_id, name, points, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#
        )
        .bind(route.id)
        .bind(route.user_id)
        .bind(&route.name)
        .bind(serde_json::to_value(&route.points).unwrap())
        .bind(route.created_at)
        .bind(route.updated_at)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(route_id = %route.id, "route created successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(route_id = %id))]
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Route>, RepositoryError> {
        tracing::debug!("finding route by id");

        let route = sqlx::query_as::<_, Route>(
            r#"
            SELECT id, user_id, name, points, created_at, updated_at, share_token
            FROM routes
            WHERE id = $1
            "#
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        Ok(route)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id))]
    async fn find_by_user_id(&self, user_id: Uuid) -> Result<Vec<Route>, RepositoryError> {
        tracing::debug!("finding routes by user_id");

        let routes = sqlx::query_as::<_, Route>(
            r#"
            SELECT id, user_id, name, points, created_at, updated_at, share_token
            FROM routes
            WHERE user_id = $1
            ORDER BY created_at DESC
            "#
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(user_id = %user_id, count = routes.len(), "found routes");
        Ok(routes)
    }

    #[tracing::instrument(skip(self, route), fields(route_id = %route.id))]
    async fn update(&self, route: &Route) -> Result<(), RepositoryError> {
        tracing::debug!("updating route");

        let result = sqlx::query(
            r#"
            UPDATE routes
            SET name = $2, points = $3, updated_at = $4
            WHERE id = $1
            "#
        )
        .bind(route.id)
        .bind(&route.name)
        .bind(serde_json::to_value(&route.points).unwrap())
        .bind(route.updated_at)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(RepositoryError::NotFound);
        }

        tracing::debug!(route_id = %route.id, "route updated successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(route_id = %id))]
    async fn set_share_token(&self, id: Uuid, token: Option<Uuid>) -> Result<(), RepositoryError> {
        tracing::debug!(?token, "setting share token");

        let result = sqlx::query(
            r#"
            UPDATE routes
            SET share_token = $2
            WHERE id = $1
            "#
        )
        .bind(id)
        .bind(token)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(RepositoryError::NotFound);
        }

        tracing::debug!(route_id = %id, "share token set successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(share_token = %token))]
    async fn find_by_share_token(&self, token: Uuid) -> Result<Option<Route>, RepositoryError> {
        tracing::debug!("finding route by share token");

        let route = sqlx::query_as::<_, Route>(
            r#"
            SELECT id, user_id, name, points, created_at, updated_at, share_token
            FROM routes
            WHERE share_token = $1
            "#
        )
        .bind(token)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        Ok(route)
    }

    #[tracing::instrument(skip(self), fields(route_id = %id))]
    async fn delete(&self, id: Uuid) -> Result<(), RepositoryError> {
        tracing::debug!("deleting route");

        let result = sqlx::query(
            r#"
            DELETE FROM routes
            WHERE id = $1
            "#
        )
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(RepositoryError::NotFound);
        }

        tracing::debug!(route_id = %id, "route deleted successfully");
        Ok(())
    }
}

pub struct PostgresCommentRepository {
    pool: PgPool,
}

impl PostgresCommentRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl CommentRepository for PostgresCommentRepository {
    #[tracing::instrument(skip(self, comment), fields(comment_id = %comment.id, route_id = %comment.route_id))]
    async fn create(&self, comment: &Comment) -> Result<(), RepositoryError> {
        tracing::debug!("creating comment");

        sqlx::query(
            r#"
            INSERT INTO comments (id, route_id, user_id, author_name, text, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(comment.id)
        .bind(comment.route_id)
        .bind(comment.user_id)
        .bind(&comment.author_name)
        .bind(&comment.text)
        .bind(comment.created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(comment_id = %comment.id, "comment created successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id))]
    async fn find_by_route_id(&self, route_id: Uuid) -> Result<Vec<Comment>, RepositoryError> {
        tracing::debug!("finding comments by route_id");

        let comments = sqlx::query_as::<_, Comment>(
            r#"
            SELECT id, route_id, user_id, author_name, text, created_at
            FROM comments
            WHERE route_id = $1
            ORDER BY created_at ASC
            "#,
        )
        .bind(route_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(route_id = %route_id, count = comments.len(), "found comments");
        Ok(comments)
    }

    #[tracing::instrument(skip(self), fields(comment_id = %id))]
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Comment>, RepositoryError> {
        tracing::debug!("finding comment by id");

        let comment = sqlx::query_as::<_, Comment>(
            r#"
            SELECT id, route_id, user_id, author_name, text, created_at
            FROM comments
            WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        Ok(comment)
    }

    #[tracing::instrument(skip(self), fields(comment_id = %id))]
    async fn delete(&self, id: Uuid) -> Result<(), RepositoryError> {
        tracing::debug!("deleting comment");

        let result = sqlx::query(
            r#"
            DELETE FROM comments
            WHERE id = $1
            "#,
        )
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(RepositoryError::NotFound);
        }

        tracing::debug!(comment_id = %id, "comment deleted successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id))]
    async fn count_by_route_id(&self, route_id: Uuid) -> Result<i64, RepositoryError> {
        tracing::debug!("counting comments by route_id");

        let count: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*) FROM comments WHERE route_id = $1
            "#,
        )
        .bind(route_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(route_id = %route_id, count = count.0, "counted comments");
        Ok(count.0)
    }
}

pub async fn create_pool(database_url: &str, max_connections: u32) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(max_connections)
        .connect(database_url)
        .await
}
