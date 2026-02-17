use sqlx::{postgres::PgPoolOptions, PgPool};
use uuid::Uuid;

use crate::{
    domain::comment::Comment,
    domain::like::RouteLike,
    domain::rating::RouteRating,
    domain::route::{ExploreRouteRow, Route},
    repository::errors::RepositoryError,
    usecase::contracts::{CommentRepository, LikeRepository, RatingRepository, RouteRepository},
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
            INSERT INTO routes (id, user_id, name, points, created_at, updated_at, tags)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#
        )
        .bind(route.id)
        .bind(route.user_id)
        .bind(&route.name)
        .bind(serde_json::to_value(&route.points).unwrap())
        .bind(route.created_at)
        .bind(route.updated_at)
        .bind(&route.tags)
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
            SELECT id, user_id, name, points, created_at, updated_at, share_token, tags
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
            SELECT id, user_id, name, points, created_at, updated_at, share_token, tags
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
            SET name = $2, points = $3, updated_at = $4, tags = $5
            WHERE id = $1
            "#
        )
        .bind(route.id)
        .bind(&route.name)
        .bind(serde_json::to_value(&route.points).unwrap())
        .bind(route.updated_at)
        .bind(&route.tags)
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
            SELECT id, user_id, name, points, created_at, updated_at, share_token, tags
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

    #[tracing::instrument(skip(self), fields(?search, ?tag, %order_clause, %limit, %offset))]
    async fn explore_shared(
        &self,
        search: Option<String>,
        tag: Option<String>,
        order_clause: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<ExploreRouteRow>, RepositoryError> {
        tracing::debug!("exploring shared routes");

        let query = format!(
            r#"
            SELECT r.id, r.name,
                   jsonb_array_length(r.points) AS points_count,
                   r.created_at, r.share_token,
                   COALESCE(l.likes_count, 0) AS likes_count,
                   COALESCE(rt.avg_rating, 0.0) AS avg_rating,
                   COALESCE(rt.ratings_count, 0) AS ratings_count,
                   r.tags
            FROM routes r
            LEFT JOIN (SELECT route_id, COUNT(*) AS likes_count FROM route_likes GROUP BY route_id) l ON l.route_id = r.id
            LEFT JOIN (SELECT route_id, AVG(rating::float8) AS avg_rating, COUNT(*) AS ratings_count FROM route_ratings GROUP BY route_id) rt ON rt.route_id = r.id
            WHERE r.share_token IS NOT NULL
              AND ($1::text IS NULL OR r.name ILIKE '%' || $1 || '%')
              AND ($2::text IS NULL OR r.tags @> ARRAY[$2])
            ORDER BY {}
            LIMIT $3 OFFSET $4
            "#,
            order_clause
        );

        let rows = sqlx::query_as::<_, ExploreRouteRow>(&query)
            .bind(search.as_deref())
            .bind(tag.as_deref())
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(count = rows.len(), "explored shared routes");
        Ok(rows)
    }

    #[tracing::instrument(skip(self), fields(?search, ?tag))]
    async fn count_explore_shared(&self, search: Option<String>, tag: Option<String>) -> Result<i64, RepositoryError> {
        tracing::debug!("counting explore shared routes");

        let count: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*) FROM routes
            WHERE share_token IS NOT NULL
              AND ($1::text IS NULL OR name ILIKE '%' || $1 || '%')
              AND ($2::text IS NULL OR tags @> ARRAY[$2])
            "#,
        )
        .bind(search.as_deref())
        .bind(tag.as_deref())
        .fetch_one(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(count = count.0, "counted explore shared routes");
        Ok(count.0)
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

pub struct PostgresLikeRepository {
    pool: PgPool,
}

impl PostgresLikeRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl LikeRepository for PostgresLikeRepository {
    #[tracing::instrument(skip(self, like), fields(like_id = %like.id, route_id = %like.route_id, user_id = %like.user_id))]
    async fn create(&self, like: &RouteLike) -> Result<(), RepositoryError> {
        tracing::debug!("creating route like");

        sqlx::query(
            r#"
            INSERT INTO route_likes (id, route_id, user_id, created_at)
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(like.id)
        .bind(like.route_id)
        .bind(like.user_id)
        .bind(like.created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(like_id = %like.id, "route like created successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id, user_id = %user_id))]
    async fn delete_by_route_and_user(
        &self,
        route_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), RepositoryError> {
        tracing::debug!("deleting route like");

        let result = sqlx::query(
            r#"
            DELETE FROM route_likes
            WHERE route_id = $1 AND user_id = $2
            "#,
        )
        .bind(route_id)
        .bind(user_id)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(RepositoryError::NotFound);
        }

        tracing::debug!("route like deleted successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id, user_id = %user_id))]
    async fn find_by_route_and_user(
        &self,
        route_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<RouteLike>, RepositoryError> {
        tracing::debug!("finding route like by route and user");

        let like = sqlx::query_as::<_, RouteLike>(
            r#"
            SELECT id, route_id, user_id, created_at
            FROM route_likes
            WHERE route_id = $1 AND user_id = $2
            "#,
        )
        .bind(route_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        Ok(like)
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id))]
    async fn count_by_route_id(&self, route_id: Uuid) -> Result<i64, RepositoryError> {
        tracing::debug!("counting likes by route_id");

        let count: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*) FROM route_likes WHERE route_id = $1
            "#,
        )
        .bind(route_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(route_id = %route_id, count = count.0, "counted likes");
        Ok(count.0)
    }
}

pub struct PostgresRatingRepository {
    pool: PgPool,
}

impl PostgresRatingRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl RatingRepository for PostgresRatingRepository {
    #[tracing::instrument(skip(self, rating), fields(rating_id = %rating.id, route_id = %rating.route_id, user_id = %rating.user_id, rating_value = rating.rating))]
    async fn upsert(&self, rating: &RouteRating) -> Result<(), RepositoryError> {
        tracing::debug!("upserting route rating");

        sqlx::query(
            r#"
            INSERT INTO route_ratings (id, route_id, user_id, rating, created_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (route_id, user_id)
            DO UPDATE SET rating = $4, created_at = $5
            "#,
        )
        .bind(rating.id)
        .bind(rating.route_id)
        .bind(rating.user_id)
        .bind(rating.rating)
        .bind(rating.created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(rating_id = %rating.id, "route rating upserted successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id, user_id = %user_id))]
    async fn delete_by_route_and_user(
        &self,
        route_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), RepositoryError> {
        tracing::debug!("deleting route rating");

        let result = sqlx::query(
            r#"
            DELETE FROM route_ratings
            WHERE route_id = $1 AND user_id = $2
            "#,
        )
        .bind(route_id)
        .bind(user_id)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(RepositoryError::NotFound);
        }

        tracing::debug!("route rating deleted successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id, user_id = %user_id))]
    async fn find_by_route_and_user(
        &self,
        route_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<RouteRating>, RepositoryError> {
        tracing::debug!("finding route rating by route and user");

        let rating = sqlx::query_as::<_, RouteRating>(
            r#"
            SELECT id, route_id, user_id, rating, created_at
            FROM route_ratings
            WHERE route_id = $1 AND user_id = $2
            "#,
        )
        .bind(route_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        Ok(rating)
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id))]
    async fn get_aggregate(&self, route_id: Uuid) -> Result<(f64, i64), RepositoryError> {
        tracing::debug!("getting rating aggregate");

        let result: (Option<f64>, i64) = sqlx::query_as(
            r#"
            SELECT COALESCE(AVG(rating::float8), 0.0), COUNT(*)
            FROM route_ratings
            WHERE route_id = $1
            "#,
        )
        .bind(route_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        let average = result.0.unwrap_or(0.0);
        tracing::debug!(route_id = %route_id, average, count = result.1, "rating aggregate retrieved");
        Ok((average, result.1))
    }
}

pub async fn create_pool(database_url: &str, max_connections: u32) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(max_connections)
        .connect(database_url)
        .await
}
