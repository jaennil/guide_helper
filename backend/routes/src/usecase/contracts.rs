use uuid::Uuid;

use crate::{domain::route::Route, repository::errors::RepositoryError};

#[cfg_attr(test, mockall::automock)]
pub trait RouteRepository: Send + Sync {
    async fn create(&self, route: &Route) -> Result<(), RepositoryError>;
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Route>, RepositoryError>;
    async fn find_by_user_id(&self, user_id: Uuid) -> Result<Vec<Route>, RepositoryError>;
    async fn update(&self, route: &Route) -> Result<(), RepositoryError>;
    async fn delete(&self, id: Uuid) -> Result<(), RepositoryError>;
}
