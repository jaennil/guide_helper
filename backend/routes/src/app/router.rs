use std::sync::Arc;

use axum::{
    Router,
    extract::{DefaultBodyLimit, State},
    middleware,
    routing::{delete, get, post, put},
};
use tower_http::trace::TraceLayer;

use crate::app::state::AppState;
use crate::delivery::http::v1::admin::{get_routes_stats, list_admin_comments, list_admin_routes};
use crate::delivery::http::v1::bookmarks::{
    get_user_bookmark_status, list_bookmarks, toggle_bookmark,
};
use crate::delivery::http::v1::categories::{
    create_category, delete_category, list_categories, update_category,
};
use crate::delivery::http::v1::chat::{
    chat_health, delete_conversation, delete_message, get_chat_history, list_conversations,
    send_chat_message, send_chat_message_stream,
};
use crate::delivery::http::v1::comments::{
    count_comments, create_comment, delete_comment, list_comments,
};
use crate::delivery::http::v1::likes::{get_like_count, get_user_like_status, toggle_like};
use crate::delivery::http::v1::middleware::auth_middleware;
use crate::delivery::http::v1::notifications::{
    get_unread_count, list_notifications, mark_all_as_read, mark_as_read,
};
use crate::delivery::http::v1::ratings::{
    get_rating_aggregate, get_user_rating, remove_rating, set_rating,
};
use crate::delivery::http::v1::routes::{
    create_route, delete_route, disable_share, enable_share, explore_routes, generate_description,
    get_route, get_route_versions, get_shared_route, import_route_from_geojson, list_routes,
    save_description, update_route,
};
use crate::delivery::http::v1::settings::{get_difficulty_thresholds, set_difficulty_thresholds};
use crate::delivery::http::v1::ws::websocket_handler;

const ROUTE_JSON_BODY_LIMIT_BYTES: usize = 25 * 1024 * 1024;

pub fn build_router(shared_state: Arc<AppState>) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/metrics", get(metrics))
        .route("/api/v1/routes/explore", get(explore_routes))
        .route("/api/v1/shared/{token}", get(get_shared_route))
        .route("/api/v1/routes/{route_id}/ws", get(websocket_handler))
        .route("/api/v1/routes/{route_id}/comments", get(list_comments))
        .route(
            "/api/v1/routes/{route_id}/comments/count",
            get(count_comments),
        )
        .route("/api/v1/routes/{route_id}/like", get(get_like_count))
        .route(
            "/api/v1/routes/{route_id}/rating",
            get(get_rating_aggregate),
        )
        .route(
            "/api/v1/settings/difficulty",
            get(get_difficulty_thresholds),
        )
        .route("/api/v1/categories", get(list_categories))
        .route("/api/v1/chat/health", get(chat_health))
        .merge(build_authenticated_api(shared_state.clone()))
        .layer(TraceLayer::new_for_http())
        .with_state(shared_state)
}

fn build_authenticated_api(shared_state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/v1/routes", get(list_routes).post(create_route))
        .route("/api/v1/routes/import", post(import_route_from_geojson))
        .route("/api/v1/routes/{id}/versions", get(get_route_versions))
        .route(
            "/api/v1/routes/{id}",
            get(get_route).put(update_route).delete(delete_route),
        )
        .route(
            "/api/v1/routes/{id}/share",
            post(enable_share).delete(disable_share),
        )
        .route("/api/v1/routes/{route_id}/comments", post(create_comment))
        .route("/api/v1/comments/{comment_id}", delete(delete_comment))
        .route("/api/v1/routes/{route_id}/like", post(toggle_like))
        .route(
            "/api/v1/routes/{route_id}/like/me",
            get(get_user_like_status),
        )
        .route(
            "/api/v1/routes/{route_id}/rating",
            put(set_rating).delete(remove_rating),
        )
        .route("/api/v1/routes/{route_id}/rating/me", get(get_user_rating))
        .route(
            "/api/v1/routes/{route_id}/description/generate",
            post(generate_description),
        )
        .route(
            "/api/v1/routes/{route_id}/description",
            post(save_description),
        )
        .route("/api/v1/routes/{route_id}/bookmark", post(toggle_bookmark))
        .route(
            "/api/v1/routes/{route_id}/bookmark/me",
            get(get_user_bookmark_status),
        )
        .route("/api/v1/bookmarks", get(list_bookmarks))
        .route("/api/v1/admin/routes/stats", get(get_routes_stats))
        .route("/api/v1/admin/routes", get(list_admin_routes))
        .route("/api/v1/admin/comments", get(list_admin_comments))
        .route("/api/v1/admin/categories", post(create_category))
        .route(
            "/api/v1/admin/categories/{id}",
            put(update_category).delete(delete_category),
        )
        .route("/api/v1/notifications", get(list_notifications))
        .route("/api/v1/notifications/unread-count", get(get_unread_count))
        .route("/api/v1/notifications/{id}/read", post(mark_as_read))
        .route("/api/v1/notifications/read-all", post(mark_all_as_read))
        .route(
            "/api/v1/admin/settings/difficulty",
            put(set_difficulty_thresholds),
        )
        .route(
            "/api/v1/chat",
            get(list_conversations).post(send_chat_message),
        )
        .route(
            "/api/v1/chat/{conversation_id}",
            get(get_chat_history).delete(delete_conversation),
        )
        .route("/api/v1/chat/stream", post(send_chat_message_stream))
        .route(
            "/api/v1/chat/{conversation_id}/messages/{message_id}",
            delete(delete_message),
        )
        .layer(DefaultBodyLimit::max(ROUTE_JSON_BODY_LIMIT_BYTES))
        .layer(middleware::from_fn_with_state(
            shared_state,
            auth_middleware,
        ))
}

async fn metrics(State(state): State<Arc<AppState>>) -> String {
    metrics_process::Collector::default().collect();
    state.metrics_handle.render()
}

#[tracing::instrument]
async fn healthz() -> &'static str {
    "OK"
}
