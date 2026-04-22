use std::collections::HashMap;
use std::sync::Arc;

use futures::StreamExt;
use tokio::sync::{RwLock, broadcast};
use uuid::Uuid;

use crate::app::state::AppState;

pub fn spawn_rate_limiter_cleanup(shared_state: &Arc<AppState>) {
    let rate_limits = shared_state.chat_rate_limits.clone();
    let window_secs = shared_state.chat_rate_limit_window_secs;

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        loop {
            interval.tick().await;
            let now = std::time::Instant::now();
            let mut limits = rate_limits.write().await;
            let before = limits.len();
            limits
                .retain(|_, (timestamp, _)| now.duration_since(*timestamp).as_secs() < window_secs);
            let cleaned = before - limits.len();
            if cleaned > 0 {
                tracing::info!(
                    cleaned,
                    remaining = limits.len(),
                    "rate limiter cleanup completed"
                );
            } else {
                tracing::debug!(
                    entries = limits.len(),
                    "rate limiter cleanup: nothing to clean"
                );
            }
        }
    });

    tracing::info!("rate limiter cleanup task spawned (every 5 minutes)");
}

pub fn spawn_photo_completion_subscriber(
    nats_client: Option<async_nats::Client>,
    channels: Arc<RwLock<HashMap<Uuid, broadcast::Sender<String>>>>,
) {
    let Some(nats_client) = nats_client else {
        return;
    };

    tokio::spawn(async move {
        tracing::info!("subscribing to photos.completed.* for WS notifications");
        match nats_client.subscribe("photos.completed.*").await {
            Ok(mut subscriber) => {
                tracing::info!("NATS subscriber for photo completions ready");
                while let Some(msg) = subscriber.next().await {
                    let subject = msg.subject.as_str();
                    let route_id_str = match subject.strip_prefix("photos.completed.") {
                        Some(id) => id,
                        None => {
                            tracing::warn!(subject = %subject, "unexpected subject format");
                            continue;
                        }
                    };
                    let route_id = match route_id_str.parse::<Uuid>() {
                        Ok(id) => id,
                        Err(e) => {
                            tracing::warn!(
                                route_id = %route_id_str,
                                error = %e,
                                "failed to parse route_id from NATS subject"
                            );
                            continue;
                        }
                    };

                    let payload = match String::from_utf8(msg.payload.to_vec()) {
                        Ok(s) => s,
                        Err(e) => {
                            tracing::warn!(
                                route_id = %route_id,
                                error = %e,
                                "invalid UTF-8 in NATS message payload"
                            );
                            continue;
                        }
                    };

                    let channels_read = channels.read().await;
                    if let Some(tx) = channels_read.get(&route_id) {
                        let receiver_count = tx.receiver_count();
                        match tx.send(payload) {
                            Ok(_) => {
                                tracing::info!(
                                    route_id = %route_id,
                                    receivers = receiver_count,
                                    "forwarded photo completion to WS clients"
                                );
                            }
                            Err(_) => {
                                tracing::debug!(
                                    route_id = %route_id,
                                    "no active WS receivers for route"
                                );
                            }
                        }
                    } else {
                        tracing::debug!(
                            route_id = %route_id,
                            "no WS channel for route, skipping"
                        );
                    }
                }
                tracing::warn!("NATS photo completion subscriber ended");
            }
            Err(e) => {
                tracing::error!(error = %e, "failed to subscribe to photos.completed.*");
            }
        }
    });
}
