use sqlx::{postgres::PgPoolOptions, PgPool};
use uuid::Uuid;

use crate::{
    domain::bookmark::RouteBookmark,
    domain::category::Category,
    domain::chat_message::{ChatMessage, ConversationSummary},
    domain::comment::Comment,
    domain::like::RouteLike,
    domain::notification::Notification,
    domain::rating::RouteRating,
    domain::route::{AdminRouteRow, ExploreRouteRow, Route},
    repository::errors::RepositoryError,
    usecase::contracts::{BookmarkRepository, CategoryRepository, ChatMessageRepository, CommentRepository, LikeRepository, NotificationRepository, RatingRepository, RouteRepository, SettingsRepository},
};

#[derive(Clone)]
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

        let mut tx = self.pool.begin().await.map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

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
        .execute(&mut *tx)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        for category_id in &route.category_ids {
            sqlx::query(
                r#"
                INSERT INTO route_categories (route_id, category_id)
                VALUES ($1, $2)
                "#
            )
            .bind(route.id)
            .bind(category_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;
        }

        tx.commit().await.map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(route_id = %route.id, category_count = route.category_ids.len(), "route created successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(route_id = %id))]
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Route>, RepositoryError> {
        tracing::debug!("finding route by id");

        let route = sqlx::query_as::<_, Route>(
            r#"
            SELECT r.id, r.user_id, r.name, r.points, r.created_at, r.updated_at, r.share_token,
                   COALESCE(ARRAY(SELECT category_id FROM route_categories WHERE route_id = r.id), ARRAY[]::uuid[]) AS category_ids,
                   r.start_location, r.end_location
            FROM routes r
            WHERE r.id = $1
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
            SELECT r.id, r.user_id, r.name, r.points, r.created_at, r.updated_at, r.share_token,
                   COALESCE(ARRAY(SELECT category_id FROM route_categories WHERE route_id = r.id), ARRAY[]::uuid[]) AS category_ids,
                   r.start_location, r.end_location
            FROM routes r
            WHERE r.user_id = $1
            ORDER BY r.created_at DESC
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

        let mut tx = self.pool.begin().await.map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

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
        .execute(&mut *tx)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(RepositoryError::NotFound);
        }

        sqlx::query("DELETE FROM route_categories WHERE route_id = $1")
            .bind(route.id)
            .execute(&mut *tx)
            .await
            .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        for category_id in &route.category_ids {
            sqlx::query(
                r#"
                INSERT INTO route_categories (route_id, category_id)
                VALUES ($1, $2)
                "#
            )
            .bind(route.id)
            .bind(category_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;
        }

        tx.commit().await.map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(route_id = %route.id, category_count = route.category_ids.len(), "route updated successfully");
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
            SELECT r.id, r.user_id, r.name, r.points, r.created_at, r.updated_at, r.share_token,
                   COALESCE(ARRAY(SELECT category_id FROM route_categories WHERE route_id = r.id), ARRAY[]::uuid[]) AS category_ids,
                   r.start_location, r.end_location
            FROM routes r
            WHERE r.share_token = $1
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

    #[tracing::instrument(skip(self), fields(?search, ?category_id, %order_clause, %limit, %offset))]
    async fn explore_shared(
        &self,
        search: Option<String>,
        category_id: Option<Uuid>,
        order_clause: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<ExploreRouteRow>, RepositoryError> {
        tracing::debug!("exploring shared routes");

        let query = format!(
            r#"
            SELECT r.id, r.name,
                   jsonb_array_length(r.points)::bigint AS points_count,
                   r.created_at, r.share_token,
                   COALESCE(l.likes_count, 0) AS likes_count,
                   COALESCE(rt.avg_rating, 0.0) AS avg_rating,
                   COALESCE(rt.ratings_count, 0) AS ratings_count,
                   COALESCE(ARRAY(SELECT category_id FROM route_categories WHERE route_id = r.id), ARRAY[]::uuid[]) AS category_ids
            FROM routes r
            LEFT JOIN (SELECT route_id, COUNT(*) AS likes_count FROM route_likes GROUP BY route_id) l ON l.route_id = r.id
            LEFT JOIN (SELECT route_id, AVG(rating::float8) AS avg_rating, COUNT(*) AS ratings_count FROM route_ratings GROUP BY route_id) rt ON rt.route_id = r.id
            WHERE r.share_token IS NOT NULL
              AND ($1::text IS NULL OR r.name ILIKE '%' || $1 || '%')
              AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM route_categories WHERE route_id = r.id AND category_id = $2))
            ORDER BY {}
            LIMIT $3 OFFSET $4
            "#,
            order_clause
        );

        let rows = sqlx::query_as::<_, ExploreRouteRow>(&query)
            .bind(search.as_deref())
            .bind(category_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(count = rows.len(), "explored shared routes");
        Ok(rows)
    }

    #[tracing::instrument(skip(self), fields(?search, ?category_id))]
    async fn count_explore_shared(&self, search: Option<String>, category_id: Option<Uuid>) -> Result<i64, RepositoryError> {
        tracing::debug!("counting explore shared routes");

        let count: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*) FROM routes r
            WHERE r.share_token IS NOT NULL
              AND ($1::text IS NULL OR r.name ILIKE '%' || $1 || '%')
              AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM route_categories WHERE route_id = r.id AND category_id = $2))
            "#,
        )
        .bind(search.as_deref())
        .bind(category_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(count = count.0, "counted explore shared routes");
        Ok(count.0)
    }

    #[tracing::instrument(skip(self))]
    async fn count_all(&self) -> Result<i64, RepositoryError> {
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM routes")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(count = count.0, "counted all routes");
        Ok(count.0)
    }

    #[tracing::instrument(skip(self), fields(%limit, %offset))]
    async fn find_all_admin(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<AdminRouteRow>, RepositoryError> {
        tracing::debug!("listing all routes for admin");

        let rows = sqlx::query_as::<_, AdminRouteRow>(
            r#"
            SELECT r.id, r.user_id, r.name,
                   jsonb_array_length(r.points)::bigint AS points_count,
                   r.created_at, r.share_token,
                   COALESCE(ARRAY(SELECT category_id FROM route_categories WHERE route_id = r.id), ARRAY[]::uuid[]) AS category_ids
            FROM routes r
            ORDER BY r.created_at DESC
            LIMIT $1 OFFSET $2
            "#,
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(count = rows.len(), "admin routes listed");
        Ok(rows)
    }

    #[tracing::instrument(skip(self), fields(route_id = %id))]
    async fn update_locations(
        &self,
        id: Uuid,
        start_location: Option<String>,
        end_location: Option<String>,
    ) -> Result<(), RepositoryError> {
        tracing::debug!(?start_location, ?end_location, "updating route locations");

        sqlx::query(
            r#"
            UPDATE routes SET start_location = $2, end_location = $3 WHERE id = $1
            "#,
        )
        .bind(id)
        .bind(&start_location)
        .bind(&end_location)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(route_id = %id, "route locations updated");
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

    #[tracing::instrument(skip(self))]
    async fn count_all(&self) -> Result<i64, RepositoryError> {
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM comments")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(count = count.0, "counted all comments");
        Ok(count.0)
    }

    #[tracing::instrument(skip(self), fields(%limit, %offset))]
    async fn find_all_paginated(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Comment>, RepositoryError> {
        tracing::debug!("listing all comments paginated for admin");

        let comments = sqlx::query_as::<_, Comment>(
            r#"
            SELECT id, route_id, user_id, author_name, text, created_at
            FROM comments
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
            "#,
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(count = comments.len(), "admin comments listed");
        Ok(comments)
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

pub struct PostgresSettingsRepository {
    pool: PgPool,
}

impl PostgresSettingsRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl SettingsRepository for PostgresSettingsRepository {
    #[tracing::instrument(skip(self), fields(%key))]
    async fn get_value(&self, key: &str) -> Result<Option<serde_json::Value>, RepositoryError> {
        tracing::debug!("getting setting value");

        let row: Option<(serde_json::Value,)> = sqlx::query_as(
            "SELECT value FROM settings WHERE key = $1",
        )
        .bind(key)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(key, found = row.is_some(), "setting value retrieved");
        Ok(row.map(|r| r.0))
    }

    #[tracing::instrument(skip(self, value), fields(%key))]
    async fn set_value(&self, key: &str, value: &serde_json::Value) -> Result<(), RepositoryError> {
        tracing::debug!("setting value");

        sqlx::query(
            r#"
            INSERT INTO settings (key, value, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
            "#,
        )
        .bind(key)
        .bind(value)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(key, "setting value saved");
        Ok(())
    }
}

pub struct PostgresCategoryRepository {
    pool: PgPool,
}

impl PostgresCategoryRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl CategoryRepository for PostgresCategoryRepository {
    #[tracing::instrument(skip(self, category), fields(category_id = %category.id))]
    async fn create(&self, category: &Category) -> Result<(), RepositoryError> {
        tracing::debug!("creating category");

        sqlx::query(
            r#"
            INSERT INTO categories (id, name, created_at)
            VALUES ($1, $2, $3)
            "#,
        )
        .bind(category.id)
        .bind(&category.name)
        .bind(category.created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(category_id = %category.id, "category created successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self))]
    async fn find_all(&self) -> Result<Vec<Category>, RepositoryError> {
        tracing::debug!("finding all categories");

        let categories = sqlx::query_as::<_, Category>(
            r#"
            SELECT id, name, created_at
            FROM categories
            ORDER BY name ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(count = categories.len(), "found categories");
        Ok(categories)
    }

    #[tracing::instrument(skip(self), fields(category_id = %id))]
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Category>, RepositoryError> {
        tracing::debug!("finding category by id");

        let category = sqlx::query_as::<_, Category>(
            r#"
            SELECT id, name, created_at
            FROM categories
            WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        Ok(category)
    }

    #[tracing::instrument(skip(self), fields(category_id = %id, %name))]
    async fn update(&self, id: Uuid, name: &str) -> Result<(), RepositoryError> {
        tracing::debug!("updating category");

        let result = sqlx::query(
            r#"
            UPDATE categories
            SET name = $2
            WHERE id = $1
            "#,
        )
        .bind(id)
        .bind(name)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(RepositoryError::NotFound);
        }

        tracing::debug!(category_id = %id, "category updated successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(category_id = %id))]
    async fn delete(&self, id: Uuid) -> Result<(), RepositoryError> {
        tracing::debug!("deleting category");

        let result = sqlx::query(
            r#"
            DELETE FROM categories
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

        tracing::debug!(category_id = %id, "category deleted successfully");
        Ok(())
    }
}

pub struct PostgresNotificationRepository {
    pool: PgPool,
}

impl PostgresNotificationRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl NotificationRepository for PostgresNotificationRepository {
    #[tracing::instrument(skip(self, notification), fields(notification_id = %notification.id, user_id = %notification.user_id))]
    async fn create(&self, notification: &Notification) -> Result<(), RepositoryError> {
        tracing::debug!("creating notification");

        sqlx::query(
            r#"
            INSERT INTO notifications (id, user_id, notification_type, route_id, actor_name, message, is_read, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            "#,
        )
        .bind(notification.id)
        .bind(notification.user_id)
        .bind(&notification.notification_type)
        .bind(notification.route_id)
        .bind(&notification.actor_name)
        .bind(&notification.message)
        .bind(notification.is_read)
        .bind(notification.created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(notification_id = %notification.id, "notification created successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, %limit, %offset))]
    async fn find_by_user_id(
        &self,
        user_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Notification>, RepositoryError> {
        tracing::debug!("finding notifications by user_id");

        let notifications = sqlx::query_as::<_, Notification>(
            r#"
            SELECT id, user_id, notification_type, route_id, actor_name, message, is_read, created_at
            FROM notifications
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(user_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(user_id = %user_id, count = notifications.len(), "found notifications");
        Ok(notifications)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id))]
    async fn count_unread(&self, user_id: Uuid) -> Result<i64, RepositoryError> {
        tracing::debug!("counting unread notifications");

        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = FALSE",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(user_id = %user_id, count = count.0, "counted unread notifications");
        Ok(count.0)
    }

    #[tracing::instrument(skip(self), fields(notification_id = %id, user_id = %user_id))]
    async fn mark_as_read(&self, id: Uuid, user_id: Uuid) -> Result<(), RepositoryError> {
        tracing::debug!("marking notification as read");

        let result = sqlx::query(
            "UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2",
        )
        .bind(id)
        .bind(user_id)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(RepositoryError::NotFound);
        }

        tracing::debug!(notification_id = %id, "notification marked as read");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id))]
    async fn mark_all_as_read(&self, user_id: Uuid) -> Result<(), RepositoryError> {
        tracing::debug!("marking all notifications as read");

        sqlx::query(
            "UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE",
        )
        .bind(user_id)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(user_id = %user_id, "all notifications marked as read");
        Ok(())
    }
}

pub struct PostgresChatMessageRepository {
    pool: PgPool,
}

impl PostgresChatMessageRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl ChatMessageRepository for PostgresChatMessageRepository {
    #[tracing::instrument(skip(self, message), fields(message_id = %message.id, user_id = %message.user_id, conversation_id = %message.conversation_id))]
    async fn create(&self, message: &ChatMessage) -> Result<(), RepositoryError> {
        tracing::debug!(role = %message.role, "creating chat message");

        sqlx::query(
            r#"
            INSERT INTO chat_messages (id, user_id, conversation_id, role, content, actions, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
        )
        .bind(message.id)
        .bind(message.user_id)
        .bind(message.conversation_id)
        .bind(&message.role)
        .bind(&message.content)
        .bind(&message.actions)
        .bind(message.created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(message_id = %message.id, "chat message created successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, conversation_id = %conversation_id, %limit))]
    async fn find_by_conversation(
        &self,
        user_id: Uuid,
        conversation_id: Uuid,
        limit: i64,
    ) -> Result<Vec<ChatMessage>, RepositoryError> {
        tracing::debug!("finding chat messages by conversation");

        let messages = sqlx::query_as::<_, ChatMessage>(
            r#"
            SELECT * FROM (
                SELECT id, user_id, conversation_id, role, content, actions, created_at
                FROM chat_messages
                WHERE user_id = $1 AND conversation_id = $2
                ORDER BY created_at DESC
                LIMIT $3
            ) sub
            ORDER BY created_at ASC
            "#,
        )
        .bind(user_id)
        .bind(conversation_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(count = messages.len(), "found chat messages");
        Ok(messages)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, %limit, %offset))]
    async fn list_conversations(
        &self,
        user_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<ConversationSummary>, RepositoryError> {
        tracing::debug!("listing conversations");

        let rows = sqlx::query_as::<_, ConversationSummary>(
            r#"
            SELECT
                c.conversation_id,
                COALESCE(last_msg.content, '') AS last_message,
                c.message_count,
                c.created_at,
                c.updated_at,
                COALESCE(title_msg.content, '') AS title
            FROM (
                SELECT
                    conversation_id,
                    COUNT(*)::bigint AS message_count,
                    MIN(created_at) AS created_at,
                    MAX(created_at) AS updated_at
                FROM chat_messages
                WHERE user_id = $1
                GROUP BY conversation_id
                ORDER BY MAX(created_at) DESC
                LIMIT $2 OFFSET $3
            ) c
            LEFT JOIN LATERAL (
                SELECT content FROM chat_messages
                WHERE conversation_id = c.conversation_id AND user_id = $1
                ORDER BY created_at DESC LIMIT 1
            ) last_msg ON true
            LEFT JOIN LATERAL (
                SELECT LEFT(content, 100) AS content FROM chat_messages
                WHERE conversation_id = c.conversation_id AND user_id = $1 AND role = 'user'
                ORDER BY created_at ASC LIMIT 1
            ) title_msg ON true
            "#,
        )
        .bind(user_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(count = rows.len(), "listed conversations");
        Ok(rows)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, conversation_id = %conversation_id))]
    async fn delete_conversation(
        &self,
        user_id: Uuid,
        conversation_id: Uuid,
    ) -> Result<(), RepositoryError> {
        tracing::debug!("deleting conversation");

        let result = sqlx::query(
            r#"
            DELETE FROM chat_messages
            WHERE user_id = $1 AND conversation_id = $2
            "#,
        )
        .bind(user_id)
        .bind(conversation_id)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(RepositoryError::NotFound);
        }

        tracing::debug!(rows_deleted = result.rows_affected(), "conversation deleted");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, message_id = %message_id))]
    async fn delete_message(
        &self,
        user_id: Uuid,
        message_id: Uuid,
    ) -> Result<(), RepositoryError> {
        tracing::debug!("deleting chat message");

        let result = sqlx::query(
            "DELETE FROM chat_messages WHERE id = $1 AND user_id = $2",
        )
        .bind(message_id)
        .bind(user_id)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        if result.rows_affected() == 0 {
            return Err(RepositoryError::NotFound);
        }

        tracing::debug!(message_id = %message_id, "chat message deleted");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id))]
    async fn count_conversations(&self, user_id: Uuid) -> Result<i64, RepositoryError> {
        tracing::debug!("counting conversations");

        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(DISTINCT conversation_id) FROM chat_messages WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(user_id = %user_id, count = count.0, "counted conversations");
        Ok(count.0)
    }
}

pub struct PostgresBookmarkRepository {
    pool: PgPool,
}

impl PostgresBookmarkRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl BookmarkRepository for PostgresBookmarkRepository {
    #[tracing::instrument(skip(self, bookmark), fields(bookmark_id = %bookmark.id, route_id = %bookmark.route_id, user_id = %bookmark.user_id))]
    async fn create(&self, bookmark: &RouteBookmark) -> Result<(), RepositoryError> {
        tracing::debug!("creating route bookmark");

        sqlx::query(
            r#"
            INSERT INTO route_bookmarks (id, route_id, user_id, created_at)
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(bookmark.id)
        .bind(bookmark.route_id)
        .bind(bookmark.user_id)
        .bind(bookmark.created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(bookmark_id = %bookmark.id, "route bookmark created successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id, user_id = %user_id))]
    async fn delete_by_route_and_user(
        &self,
        route_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), RepositoryError> {
        tracing::debug!("deleting route bookmark");

        let result = sqlx::query(
            r#"
            DELETE FROM route_bookmarks
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

        tracing::debug!("route bookmark deleted successfully");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id, user_id = %user_id))]
    async fn find_by_route_and_user(
        &self,
        route_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<RouteBookmark>, RepositoryError> {
        tracing::debug!("finding route bookmark by route and user");

        let bookmark = sqlx::query_as::<_, RouteBookmark>(
            r#"
            SELECT id, route_id, user_id, created_at
            FROM route_bookmarks
            WHERE route_id = $1 AND user_id = $2
            "#,
        )
        .bind(route_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        Ok(bookmark)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id))]
    async fn find_by_user_id(&self, user_id: Uuid) -> Result<Vec<ExploreRouteRow>, RepositoryError> {
        tracing::debug!("finding bookmarked routes by user_id");

        let rows = sqlx::query_as::<_, ExploreRouteRow>(
            r#"
            SELECT
                r.id,
                r.name,
                jsonb_array_length(r.points)::bigint AS points_count,
                r.created_at,
                r.share_token,
                COALESCE((SELECT COUNT(*) FROM route_likes WHERE route_id = r.id), 0) AS likes_count,
                COALESCE((SELECT AVG(rating::float8) FROM route_ratings WHERE route_id = r.id), 0.0) AS avg_rating,
                COALESCE((SELECT COUNT(*) FROM route_ratings WHERE route_id = r.id), 0) AS ratings_count,
                COALESCE(ARRAY(SELECT category_id FROM route_categories WHERE route_id = r.id), ARRAY[]::uuid[]) AS category_ids
            FROM route_bookmarks rb
            JOIN routes r ON r.id = rb.route_id
            WHERE rb.user_id = $1
            ORDER BY rb.created_at DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| RepositoryError::DatabaseError(e.to_string()))?;

        tracing::debug!(user_id = %user_id, count = rows.len(), "found bookmarked routes");
        Ok(rows)
    }
}

pub async fn create_pool(database_url: &str, max_connections: u32) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(max_connections)
        .connect(database_url)
        .await
}
