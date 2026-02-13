use uuid::Uuid;

use crate::{domain::comment::Comment, domain::route::Route, repository::errors::RepositoryError};

#[cfg_attr(test, mockall::automock)]
pub trait RouteRepository: Send + Sync {
    async fn create(&self, route: &Route) -> Result<(), RepositoryError>;
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Route>, RepositoryError>;
    async fn find_by_user_id(&self, user_id: Uuid) -> Result<Vec<Route>, RepositoryError>;
    async fn update(&self, route: &Route) -> Result<(), RepositoryError>;
    async fn delete(&self, id: Uuid) -> Result<(), RepositoryError>;
    async fn set_share_token(&self, id: Uuid, token: Option<Uuid>) -> Result<(), RepositoryError>;
    async fn find_by_share_token(&self, token: Uuid) -> Result<Option<Route>, RepositoryError>;
}

#[cfg_attr(test, mockall::automock)]
pub trait CommentRepository: Send + Sync {
    async fn create(&self, comment: &Comment) -> Result<(), RepositoryError>;
    async fn find_by_route_id(&self, route_id: Uuid) -> Result<Vec<Comment>, RepositoryError>;
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Comment>, RepositoryError>;
    async fn delete(&self, id: Uuid) -> Result<(), RepositoryError>;
    async fn count_by_route_id(&self, route_id: Uuid) -> Result<i64, RepositoryError>;
}
