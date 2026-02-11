use anyhow::{anyhow, Error};
use uuid::Uuid;

use crate::domain::route::{Route, RoutePoint};
use crate::usecase::contracts::RouteRepository;

pub struct RoutesUseCase<R>
where
    R: RouteRepository,
{
    route_repository: R,
}

impl<R> RoutesUseCase<R>
where
    R: RouteRepository,
{
    pub fn new(route_repository: R) -> Self {
        Self { route_repository }
    }

    #[tracing::instrument(skip(self, points), fields(user_id = %user_id, name = %name, point_count = points.len()))]
    pub async fn create_route(
        &self,
        user_id: Uuid,
        name: String,
        points: Vec<RoutePoint>,
    ) -> Result<Route, Error> {
        tracing::debug!("creating new route");

        let route = Route::new(user_id, name, points);
        self.route_repository.create(&route).await?;

        tracing::debug!(route_id = %route.id, "route created successfully");
        Ok(route)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, route_id = %route_id))]
    pub async fn get_route(&self, user_id: Uuid, route_id: Uuid) -> Result<Route, Error> {
        tracing::debug!("getting route");

        let route = self
            .route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| anyhow!("Route not found"))?;

        // Check that route belongs to user
        if route.user_id != user_id {
            tracing::warn!("unauthorized route access attempt");
            return Err(anyhow!("Route not found"));
        }

        Ok(route)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id))]
    pub async fn get_user_routes(&self, user_id: Uuid) -> Result<Vec<Route>, Error> {
        tracing::debug!("getting user routes");

        let routes = self.route_repository.find_by_user_id(user_id).await?;

        tracing::debug!(%user_id, count = routes.len(), "retrieved user routes");
        Ok(routes)
    }

    #[tracing::instrument(skip(self, points), fields(user_id = %user_id, route_id = %route_id))]
    pub async fn update_route(
        &self,
        user_id: Uuid,
        route_id: Uuid,
        name: Option<String>,
        points: Option<Vec<RoutePoint>>,
    ) -> Result<Route, Error> {
        tracing::debug!("updating route");

        let mut route = self
            .route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| anyhow!("Route not found"))?;

        // Check that route belongs to user
        if route.user_id != user_id {
            tracing::warn!("unauthorized route update attempt");
            return Err(anyhow!("Route not found"));
        }

        route.update(name, points);
        self.route_repository.update(&route).await?;

        tracing::debug!(%route_id, "route updated successfully");
        Ok(route)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, route_id = %route_id))]
    pub async fn enable_sharing(&self, user_id: Uuid, route_id: Uuid) -> Result<Uuid, Error> {
        tracing::debug!("enabling sharing for route");

        let route = self
            .route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| anyhow!("Route not found"))?;

        if route.user_id != user_id {
            tracing::warn!("unauthorized share enable attempt");
            return Err(anyhow!("Route not found"));
        }

        // Reuse existing token if already shared
        if let Some(token) = route.share_token {
            tracing::debug!(%route_id, %token, "route already shared, returning existing token");
            return Ok(token);
        }

        let token = Uuid::new_v4();
        self.route_repository
            .set_share_token(route_id, Some(token))
            .await?;

        tracing::info!(%route_id, %token, "sharing enabled for route");
        Ok(token)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, route_id = %route_id))]
    pub async fn disable_sharing(&self, user_id: Uuid, route_id: Uuid) -> Result<(), Error> {
        tracing::debug!("disabling sharing for route");

        let route = self
            .route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| anyhow!("Route not found"))?;

        if route.user_id != user_id {
            tracing::warn!("unauthorized share disable attempt");
            return Err(anyhow!("Route not found"));
        }

        self.route_repository
            .set_share_token(route_id, None)
            .await?;

        tracing::info!(%route_id, "sharing disabled for route");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(share_token = %token))]
    pub async fn get_shared_route(&self, token: Uuid) -> Result<Route, Error> {
        tracing::debug!("getting shared route by token");

        let route = self
            .route_repository
            .find_by_share_token(token)
            .await?
            .ok_or_else(|| anyhow!("Shared route not found"))?;

        tracing::debug!(route_id = %route.id, "shared route retrieved successfully");
        Ok(route)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, route_id = %route_id))]
    pub async fn delete_route(&self, user_id: Uuid, route_id: Uuid) -> Result<(), Error> {
        tracing::debug!("deleting route");

        let route = self
            .route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| anyhow!("Route not found"))?;

        // Check that route belongs to user
        if route.user_id != user_id {
            tracing::warn!("unauthorized route delete attempt");
            return Err(anyhow!("Route not found"));
        }

        self.route_repository.delete(route_id).await?;

        tracing::debug!(%route_id, "route deleted successfully");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usecase::contracts::MockRouteRepository;

    #[tokio::test]
    async fn test_create_route() {
        let mut mock_repo = MockRouteRepository::new();

        mock_repo.expect_create().times(1).returning(|_| Ok(()));

        let usecase = RoutesUseCase::new(mock_repo);
        let user_id = Uuid::new_v4();
        let points = vec![RoutePoint {
            lat: 55.7558,
            lng: 37.6173,
            name: None,
            segment_mode: None,
            photo: None,
        }];

        let result = usecase
            .create_route(user_id, "Test Route".to_string(), points)
            .await;

        assert!(result.is_ok());
        let route = result.unwrap();
        assert_eq!(route.user_id, user_id);
        assert_eq!(route.name, "Test Route");
    }

    #[tokio::test]
    async fn test_get_route_success() {
        let mut mock_repo = MockRouteRepository::new();
        let user_id = Uuid::new_v4();
        let route_id = Uuid::new_v4();
        let route = Route {
            id: route_id,
            user_id,
            name: "Test".to_string(),
            points: vec![],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            share_token: None,
        };
        let route_clone = route.clone();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.get_route(user_id, route_id).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_get_route_not_found() {
        let mut mock_repo = MockRouteRepository::new();
        let user_id = Uuid::new_v4();
        let route_id = Uuid::new_v4();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(|_| Ok(None));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.get_route(user_id, route_id).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_route_wrong_user() {
        let mut mock_repo = MockRouteRepository::new();
        let user_id = Uuid::new_v4();
        let other_user_id = Uuid::new_v4();
        let route_id = Uuid::new_v4();
        let route = Route {
            id: route_id,
            user_id: other_user_id, // Different user
            name: "Test".to_string(),
            points: vec![],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            share_token: None,
        };
        let route_clone = route.clone();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.get_route(user_id, route_id).await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_delete_route_success() {
        let mut mock_repo = MockRouteRepository::new();
        let user_id = Uuid::new_v4();
        let route_id = Uuid::new_v4();
        let route = Route {
            id: route_id,
            user_id,
            name: "Test".to_string(),
            points: vec![],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            share_token: None,
        };
        let route_clone = route.clone();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        mock_repo
            .expect_delete()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(|_| Ok(()));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.delete_route(user_id, route_id).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_enable_sharing() {
        let mut mock_repo = MockRouteRepository::new();
        let user_id = Uuid::new_v4();
        let route_id = Uuid::new_v4();
        let route = Route {
            id: route_id,
            user_id,
            name: "Test".to_string(),
            points: vec![],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            share_token: None,
        };
        let route_clone = route.clone();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        mock_repo
            .expect_set_share_token()
            .times(1)
            .returning(|_, _| Ok(()));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.enable_sharing(user_id, route_id).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_enable_sharing_already_shared() {
        let mut mock_repo = MockRouteRepository::new();
        let user_id = Uuid::new_v4();
        let route_id = Uuid::new_v4();
        let existing_token = Uuid::new_v4();
        let route = Route {
            id: route_id,
            user_id,
            name: "Test".to_string(),
            points: vec![],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            share_token: Some(existing_token),
        };
        let route_clone = route.clone();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.enable_sharing(user_id, route_id).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), existing_token);
    }

    #[tokio::test]
    async fn test_disable_sharing() {
        let mut mock_repo = MockRouteRepository::new();
        let user_id = Uuid::new_v4();
        let route_id = Uuid::new_v4();
        let route = Route {
            id: route_id,
            user_id,
            name: "Test".to_string(),
            points: vec![],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            share_token: Some(Uuid::new_v4()),
        };
        let route_clone = route.clone();

        mock_repo
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        mock_repo
            .expect_set_share_token()
            .times(1)
            .returning(|_, _| Ok(()));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.disable_sharing(user_id, route_id).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_get_shared_route() {
        let mut mock_repo = MockRouteRepository::new();
        let token = Uuid::new_v4();
        let route = Route {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            name: "Shared".to_string(),
            points: vec![],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            share_token: Some(token),
        };
        let route_clone = route.clone();

        mock_repo
            .expect_find_by_share_token()
            .with(mockall::predicate::eq(token))
            .times(1)
            .returning(move |_| Ok(Some(route_clone.clone())));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.get_shared_route(token).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap().name, "Shared");
    }

    #[tokio::test]
    async fn test_get_shared_route_not_found() {
        let mut mock_repo = MockRouteRepository::new();
        let token = Uuid::new_v4();

        mock_repo
            .expect_find_by_share_token()
            .with(mockall::predicate::eq(token))
            .times(1)
            .returning(|_| Ok(None));

        let usecase = RoutesUseCase::new(mock_repo);
        let result = usecase.get_shared_route(token).await;

        assert!(result.is_err());
    }
}
