use anyhow::{anyhow, Error};
use uuid::Uuid;

use crate::domain::like::RouteLike;
use crate::usecase::contracts::{LikeRepository, RouteRepository};

pub struct LikesUseCase<L, R>
where
    L: LikeRepository,
    R: RouteRepository,
{
    like_repository: L,
    route_repository: R,
}

impl<L, R> LikesUseCase<L, R>
where
    L: LikeRepository,
    R: RouteRepository,
{
    pub fn new(like_repository: L, route_repository: R) -> Self {
        Self {
            like_repository,
            route_repository,
        }
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id, user_id = %user_id))]
    pub async fn toggle_like(&self, route_id: Uuid, user_id: Uuid) -> Result<bool, Error> {
        tracing::debug!("toggling like");

        // Verify route exists
        self.route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| anyhow!("Route not found"))?;

        // Check if already liked
        let existing = self
            .like_repository
            .find_by_route_and_user(route_id, user_id)
            .await?;

        if existing.is_some() {
            self.like_repository
                .delete_by_route_and_user(route_id, user_id)
                .await?;
            tracing::info!(route_id = %route_id, user_id = %user_id, "like removed");
            Ok(false)
        } else {
            let like = RouteLike::new(route_id, user_id);
            self.like_repository.create(&like).await?;
            tracing::info!(route_id = %route_id, user_id = %user_id, "like added");
            Ok(true)
        }
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id))]
    pub async fn get_like_count(&self, route_id: Uuid) -> Result<i64, Error> {
        tracing::debug!("getting like count");

        let count = self.like_repository.count_by_route_id(route_id).await?;

        tracing::debug!(route_id = %route_id, count, "like count retrieved");
        Ok(count)
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id, user_id = %user_id))]
    pub async fn get_user_like_status(
        &self,
        route_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, Error> {
        tracing::debug!("getting user like status");

        let existing = self
            .like_repository
            .find_by_route_and_user(route_id, user_id)
            .await?;

        Ok(existing.is_some())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::route::Route;
    use crate::usecase::contracts::{MockLikeRepository, MockRouteRepository};

    fn make_route(route_id: Uuid) -> Route {
        Route {
            id: route_id,
            user_id: Uuid::new_v4(),
            name: "Test".to_string(),
            points: vec![],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            share_token: None,
        }
    }

    #[tokio::test]
    async fn test_toggle_like_add() {
        let mut mock_like_repo = MockLikeRepository::new();
        let mut mock_route_repo = MockRouteRepository::new();
        let route_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let route = make_route(route_id);
        let route_clone = route.clone();

        mock_route_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        mock_like_repo
            .expect_find_by_route_and_user()
            .with(
                mockall::predicate::eq(route_id),
                mockall::predicate::eq(user_id),
            )
            .times(1)
            .returning(|_, _| Ok(None));

        mock_like_repo
            .expect_create()
            .times(1)
            .returning(|_| Ok(()));

        let usecase = LikesUseCase::new(mock_like_repo, mock_route_repo);
        let result = usecase.toggle_like(route_id, user_id).await;

        assert!(result.is_ok());
        assert!(result.unwrap()); // liked = true
    }

    #[tokio::test]
    async fn test_toggle_like_remove() {
        let mut mock_like_repo = MockLikeRepository::new();
        let mut mock_route_repo = MockRouteRepository::new();
        let route_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let route = make_route(route_id);
        let route_clone = route.clone();

        mock_route_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        let existing_like = RouteLike::new(route_id, user_id);
        mock_like_repo
            .expect_find_by_route_and_user()
            .with(
                mockall::predicate::eq(route_id),
                mockall::predicate::eq(user_id),
            )
            .times(1)
            .returning(move |r, u| Ok(Some(RouteLike::new(r, u))));

        mock_like_repo
            .expect_delete_by_route_and_user()
            .with(
                mockall::predicate::eq(route_id),
                mockall::predicate::eq(user_id),
            )
            .times(1)
            .returning(|_, _| Ok(()));

        let usecase = LikesUseCase::new(mock_like_repo, mock_route_repo);
        let result = usecase.toggle_like(route_id, user_id).await;

        assert!(result.is_ok());
        assert!(!result.unwrap()); // liked = false
    }

    #[tokio::test]
    async fn test_toggle_like_route_not_found() {
        let mock_like_repo = MockLikeRepository::new();
        let mut mock_route_repo = MockRouteRepository::new();
        let route_id = Uuid::new_v4();

        mock_route_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(|_| Ok(None));

        let usecase = LikesUseCase::new(mock_like_repo, mock_route_repo);
        let result = usecase.toggle_like(route_id, Uuid::new_v4()).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }

    #[tokio::test]
    async fn test_get_like_count() {
        let mut mock_like_repo = MockLikeRepository::new();
        let mock_route_repo = MockRouteRepository::new();
        let route_id = Uuid::new_v4();

        mock_like_repo
            .expect_count_by_route_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(|_| Ok(5));

        let usecase = LikesUseCase::new(mock_like_repo, mock_route_repo);
        let result = usecase.get_like_count(route_id).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 5);
    }

    #[tokio::test]
    async fn test_get_user_like_status_liked() {
        let mut mock_like_repo = MockLikeRepository::new();
        let mock_route_repo = MockRouteRepository::new();
        let route_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();

        mock_like_repo
            .expect_find_by_route_and_user()
            .with(
                mockall::predicate::eq(route_id),
                mockall::predicate::eq(user_id),
            )
            .times(1)
            .returning(|r, u| Ok(Some(RouteLike::new(r, u))));

        let usecase = LikesUseCase::new(mock_like_repo, mock_route_repo);
        let result = usecase.get_user_like_status(route_id, user_id).await;

        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[tokio::test]
    async fn test_get_user_like_status_not_liked() {
        let mut mock_like_repo = MockLikeRepository::new();
        let mock_route_repo = MockRouteRepository::new();
        let route_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();

        mock_like_repo
            .expect_find_by_route_and_user()
            .with(
                mockall::predicate::eq(route_id),
                mockall::predicate::eq(user_id),
            )
            .times(1)
            .returning(|_, _| Ok(None));

        let usecase = LikesUseCase::new(mock_like_repo, mock_route_repo);
        let result = usecase.get_user_like_status(route_id, user_id).await;

        assert!(result.is_ok());
        assert!(!result.unwrap());
    }
}
