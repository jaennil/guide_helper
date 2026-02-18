use uuid::Uuid;

use crate::{
    domain::category::Category,
    domain::chat_message::{ChatMessage, ConversationSummary},
    domain::comment::Comment,
    domain::like::RouteLike,
    domain::notification::Notification,
    domain::rating::RouteRating,
    domain::route::{AdminRouteRow, ExploreRouteRow, Route},
    repository::errors::RepositoryError,
};

#[cfg_attr(test, mockall::automock)]
pub trait RouteRepository: Send + Sync {
    async fn create(&self, route: &Route) -> Result<(), RepositoryError>;
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Route>, RepositoryError>;
    async fn find_by_user_id(&self, user_id: Uuid) -> Result<Vec<Route>, RepositoryError>;
    async fn update(&self, route: &Route) -> Result<(), RepositoryError>;
    async fn delete(&self, id: Uuid) -> Result<(), RepositoryError>;
    async fn set_share_token(&self, id: Uuid, token: Option<Uuid>) -> Result<(), RepositoryError>;
    async fn find_by_share_token(&self, token: Uuid) -> Result<Option<Route>, RepositoryError>;
    async fn explore_shared(
        &self,
        search: Option<String>,
        tag: Option<String>,
        order_clause: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<ExploreRouteRow>, RepositoryError>;
    async fn count_explore_shared(
        &self,
        search: Option<String>,
        tag: Option<String>,
    ) -> Result<i64, RepositoryError>;
    async fn count_all(&self) -> Result<i64, RepositoryError>;
    async fn find_all_admin(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<AdminRouteRow>, RepositoryError>;
}

#[cfg_attr(test, mockall::automock)]
pub trait CommentRepository: Send + Sync {
    async fn create(&self, comment: &Comment) -> Result<(), RepositoryError>;
    async fn find_by_route_id(&self, route_id: Uuid) -> Result<Vec<Comment>, RepositoryError>;
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Comment>, RepositoryError>;
    async fn delete(&self, id: Uuid) -> Result<(), RepositoryError>;
    async fn count_by_route_id(&self, route_id: Uuid) -> Result<i64, RepositoryError>;
    async fn count_all(&self) -> Result<i64, RepositoryError>;
    async fn find_all_paginated(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Comment>, RepositoryError>;
}

#[cfg_attr(test, mockall::automock)]
pub trait CategoryRepository: Send + Sync {
    async fn create(&self, category: &Category) -> Result<(), RepositoryError>;
    async fn find_all(&self) -> Result<Vec<Category>, RepositoryError>;
    async fn find_by_id(&self, id: Uuid) -> Result<Option<Category>, RepositoryError>;
    async fn update(&self, id: Uuid, name: &str) -> Result<(), RepositoryError>;
    async fn delete(&self, id: Uuid) -> Result<(), RepositoryError>;
}

#[cfg_attr(test, mockall::automock)]
pub trait LikeRepository: Send + Sync {
    async fn create(&self, like: &RouteLike) -> Result<(), RepositoryError>;
    async fn delete_by_route_and_user(
        &self,
        route_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), RepositoryError>;
    async fn find_by_route_and_user(
        &self,
        route_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<RouteLike>, RepositoryError>;
    async fn count_by_route_id(&self, route_id: Uuid) -> Result<i64, RepositoryError>;
}

#[cfg_attr(test, mockall::automock)]
pub trait SettingsRepository: Send + Sync {
    async fn get_value(&self, key: &str) -> Result<Option<serde_json::Value>, RepositoryError>;
    async fn set_value(&self, key: &str, value: &serde_json::Value) -> Result<(), RepositoryError>;
}

#[cfg_attr(test, mockall::automock)]
pub trait RatingRepository: Send + Sync {
    async fn upsert(&self, rating: &RouteRating) -> Result<(), RepositoryError>;
    async fn delete_by_route_and_user(
        &self,
        route_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), RepositoryError>;
    async fn find_by_route_and_user(
        &self,
        route_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<RouteRating>, RepositoryError>;
    async fn get_aggregate(&self, route_id: Uuid) -> Result<(f64, i64), RepositoryError>;
}

#[cfg_attr(test, mockall::automock)]
pub trait ChatMessageRepository: Send + Sync {
    async fn create(&self, message: &ChatMessage) -> Result<(), RepositoryError>;
    async fn find_by_conversation(
        &self,
        user_id: Uuid,
        conversation_id: Uuid,
        limit: i64,
    ) -> Result<Vec<ChatMessage>, RepositoryError>;
    async fn list_conversations(
        &self,
        user_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<ConversationSummary>, RepositoryError>;
    async fn delete_conversation(
        &self,
        user_id: Uuid,
        conversation_id: Uuid,
    ) -> Result<(), RepositoryError>;
    async fn count_conversations(&self, user_id: Uuid) -> Result<i64, RepositoryError>;
    async fn delete_message(
        &self,
        user_id: Uuid,
        message_id: Uuid,
    ) -> Result<(), RepositoryError>;
}

#[cfg_attr(test, mockall::automock)]
pub trait NotificationRepository: Send + Sync {
    async fn create(&self, notification: &Notification) -> Result<(), RepositoryError>;
    async fn find_by_user_id(
        &self,
        user_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Notification>, RepositoryError>;
    async fn count_unread(&self, user_id: Uuid) -> Result<i64, RepositoryError>;
    async fn mark_as_read(&self, id: Uuid, user_id: Uuid) -> Result<(), RepositoryError>;
    async fn mark_all_as_read(&self, user_id: Uuid) -> Result<(), RepositoryError>;
}
