use std::collections::HashMap;
use std::sync::Arc;

use metrics_exporter_prometheus::PrometheusHandle;
use tokio::sync::{RwLock, broadcast};
use uuid::Uuid;

use crate::repository::postgres::{
    PostgresBookmarkRepository, PostgresCategoryRepository, PostgresChatMessageRepository,
    PostgresCommentRepository, PostgresLikeRepository, PostgresNotificationRepository,
    PostgresRatingRepository, PostgresRouteRepository, PostgresSettingsRepository,
};
use crate::usecase::bookmarks::BookmarksUseCase;
use crate::usecase::categories::CategoriesUseCase;
use crate::usecase::chat::ChatUseCase;
use crate::usecase::comments::CommentsUseCase;
use crate::usecase::jwt::JwtService;
use crate::usecase::likes::LikesUseCase;
use crate::usecase::notifications::NotificationsUseCase;
use crate::usecase::ratings::RatingsUseCase;
use crate::usecase::routes::RoutesUseCase;
use crate::usecase::settings::SettingsUseCase;

pub struct AppState {
    pub routes_usecase: RoutesUseCase<PostgresRouteRepository>,
    pub comments_usecase: CommentsUseCase<PostgresCommentRepository, PostgresRouteRepository>,
    pub likes_usecase: LikesUseCase<PostgresLikeRepository, PostgresRouteRepository>,
    pub ratings_usecase: RatingsUseCase<PostgresRatingRepository, PostgresRouteRepository>,
    pub bookmarks_usecase: BookmarksUseCase<PostgresBookmarkRepository, PostgresRouteRepository>,
    pub settings_usecase: SettingsUseCase<PostgresSettingsRepository>,
    pub categories_usecase: CategoriesUseCase<PostgresCategoryRepository>,
    pub notifications_usecase: NotificationsUseCase<PostgresNotificationRepository>,
    pub chat_usecase: ChatUseCase<PostgresChatMessageRepository, PostgresRouteRepository>,
    pub jwt_service: JwtService,
    pub metrics_handle: PrometheusHandle,
    pub nats_client: Option<async_nats::Client>,
    pub ws_channels: Arc<RwLock<HashMap<Uuid, broadcast::Sender<String>>>>,
    pub chat_rate_limits: Arc<RwLock<HashMap<Uuid, (std::time::Instant, u32)>>>,
    pub chat_rate_limit_max: u32,
    pub chat_rate_limit_window_secs: u64,
}
