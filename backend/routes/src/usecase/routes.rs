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

    pub async fn create_route(
        &self,
        user_id: Uuid,
        name: String,
        points: Vec<RoutePoint>,
    ) -> Result<Route, Error> {
        tracing::debug!(%user_id, %name, "creating new route");

        let route = Route::new(user_id, name, points);
        self.route_repository.create(&route).await?;

        tracing::debug!(route_id = %route.id, "route created successfully");
        Ok(route)
    }

    pub async fn get_route(&self, user_id: Uuid, route_id: Uuid) -> Result<Route, Error> {
        tracing::debug!(%user_id, %route_id, "getting route");

        let route = self
            .route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| anyhow!("Route not found"))?;

        // Check that route belongs to user
        if route.user_id != user_id {
            return Err(anyhow!("Route not found"));
        }

        Ok(route)
    }

    pub async fn get_user_routes(&self, user_id: Uuid) -> Result<Vec<Route>, Error> {
        tracing::debug!(%user_id, "getting user routes");

        let routes = self.route_repository.find_by_user_id(user_id).await?;

        tracing::debug!(%user_id, count = routes.len(), "retrieved user routes");
        Ok(routes)
    }

    pub async fn update_route(
        &self,
        user_id: Uuid,
        route_id: Uuid,
        name: Option<String>,
        points: Option<Vec<RoutePoint>>,
    ) -> Result<Route, Error> {
        tracing::debug!(%user_id, %route_id, "updating route");

        let mut route = self
            .route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| anyhow!("Route not found"))?;

        // Check that route belongs to user
        if route.user_id != user_id {
            return Err(anyhow!("Route not found"));
        }

        route.update(name, points);
        self.route_repository.update(&route).await?;

        tracing::debug!(%route_id, "route updated successfully");
        Ok(route)
    }

    pub async fn delete_route(&self, user_id: Uuid, route_id: Uuid) -> Result<(), Error> {
        tracing::debug!(%user_id, %route_id, "deleting route");

        let route = self
            .route_repository
            .find_by_id(route_id)
            .await?
            .ok_or_else(|| anyhow!("Route not found"))?;

        // Check that route belongs to user
        if route.user_id != user_id {
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
}
