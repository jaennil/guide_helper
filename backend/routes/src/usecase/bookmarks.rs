use uuid::Uuid;

use crate::domain::bookmark::RouteBookmark;
use crate::domain::route::ExploreRouteRow;
use crate::usecase::contracts::{BookmarkRepository, RouteRepository};
use crate::usecase::error::UsecaseError;

pub struct BookmarksUseCase<B, R>
where
    B: BookmarkRepository,
    R: RouteRepository,
{
    bookmark_repository: B,
    route_repository: R,
}

impl<B, R> BookmarksUseCase<B, R>
where
    B: BookmarkRepository,
    R: RouteRepository,
{
    pub fn new(bookmark_repository: B, route_repository: R) -> Self {
        Self {
            bookmark_repository,
            route_repository,
        }
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id, user_id = %user_id))]
    pub async fn toggle_bookmark(
        &self,
        route_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, UsecaseError> {
        tracing::debug!("toggling bookmark");

        self.route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| UsecaseError::NotFound("Route".to_string()))?;

        let existing = self
            .bookmark_repository
            .find_by_route_and_user(route_id, user_id)
            .await?;

        if existing.is_some() {
            self.bookmark_repository
                .delete_by_route_and_user(route_id, user_id)
                .await?;
            tracing::info!(route_id = %route_id, user_id = %user_id, "bookmark removed");
            Ok(false)
        } else {
            let bookmark = RouteBookmark::new(route_id, user_id);
            self.bookmark_repository.create(&bookmark).await?;
            tracing::info!(route_id = %route_id, user_id = %user_id, "bookmark added");
            Ok(true)
        }
    }

    #[tracing::instrument(skip(self), fields(route_id = %route_id, user_id = %user_id))]
    pub async fn get_user_bookmark_status(
        &self,
        route_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, UsecaseError> {
        tracing::debug!("getting user bookmark status");

        let existing = self
            .bookmark_repository
            .find_by_route_and_user(route_id, user_id)
            .await?;

        Ok(existing.is_some())
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id))]
    pub async fn list_bookmarks(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<ExploreRouteRow>, UsecaseError> {
        tracing::debug!("listing bookmarks");

        let rows = self
            .bookmark_repository
            .find_by_user_id(user_id)
            .await?;

        tracing::debug!(user_id = %user_id, count = rows.len(), "bookmarks listed");
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::route::Route;
    use crate::usecase::contracts::{MockBookmarkRepository, MockRouteRepository};

    fn make_route(route_id: Uuid) -> Route {
        Route {
            id: route_id,
            user_id: Uuid::new_v4(),
            name: "Test".to_string(),
            points: vec![],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            share_token: None,
            category_ids: vec![],
            start_location: None,
            end_location: None,
        }
    }

    #[tokio::test]
    async fn test_toggle_bookmark_add() {
        let mut mock_bookmark_repo = MockBookmarkRepository::new();
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

        mock_bookmark_repo
            .expect_find_by_route_and_user()
            .with(
                mockall::predicate::eq(route_id),
                mockall::predicate::eq(user_id),
            )
            .times(1)
            .returning(|_, _| Ok(None));

        mock_bookmark_repo
            .expect_create()
            .times(1)
            .returning(|_| Ok(()));

        let usecase = BookmarksUseCase::new(mock_bookmark_repo, mock_route_repo);
        let result = usecase.toggle_bookmark(route_id, user_id).await;

        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[tokio::test]
    async fn test_toggle_bookmark_remove() {
        let mut mock_bookmark_repo = MockBookmarkRepository::new();
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

        mock_bookmark_repo
            .expect_find_by_route_and_user()
            .with(
                mockall::predicate::eq(route_id),
                mockall::predicate::eq(user_id),
            )
            .times(1)
            .returning(move |r, u| Ok(Some(RouteBookmark::new(r, u))));

        mock_bookmark_repo
            .expect_delete_by_route_and_user()
            .with(
                mockall::predicate::eq(route_id),
                mockall::predicate::eq(user_id),
            )
            .times(1)
            .returning(|_, _| Ok(()));

        let usecase = BookmarksUseCase::new(mock_bookmark_repo, mock_route_repo);
        let result = usecase.toggle_bookmark(route_id, user_id).await;

        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn test_toggle_bookmark_route_not_found() {
        let mock_bookmark_repo = MockBookmarkRepository::new();
        let mut mock_route_repo = MockRouteRepository::new();
        let route_id = Uuid::new_v4();

        mock_route_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(|_| Ok(None));

        let usecase = BookmarksUseCase::new(mock_bookmark_repo, mock_route_repo);
        let result = usecase.toggle_bookmark(route_id, Uuid::new_v4()).await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }
}
