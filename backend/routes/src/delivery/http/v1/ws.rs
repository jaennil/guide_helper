use std::sync::Arc;

use axum::{
    extract::{Path, Query, State, WebSocketUpgrade},
    response::Response,
};
use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::AppState;
use crate::usecase::jwt::TokenType;

#[derive(Deserialize)]
pub struct WsQuery {
    token: String,
}

pub async fn websocket_handler(
    ws: WebSocketUpgrade,
    Path(route_id): Path<Uuid>,
    Query(query): Query<WsQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    // Validate JWT from query param
    let claims = match state.jwt_service.validate_token(&query.token) {
        Ok(claims) => claims,
        Err(e) => {
            tracing::warn!(
                route_id = %route_id,
                error = %e,
                "WS connection rejected: invalid token"
            );
            return Response::builder()
                .status(401)
                .body("Unauthorized".into())
                .unwrap();
        }
    };

    if claims.token_type != TokenType::Access {
        tracing::warn!(
            route_id = %route_id,
            "WS connection rejected: not an access token"
        );
        return Response::builder()
            .status(401)
            .body("Unauthorized".into())
            .unwrap();
    }

    tracing::info!(
        route_id = %route_id,
        user_id = %claims.sub,
        "WS connection accepted, upgrading"
    );

    ws.on_upgrade(move |socket| handle_socket(socket, route_id, claims.sub, state))
}

async fn handle_socket(socket: WebSocket, route_id: Uuid, user_id: String, state: Arc<AppState>) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Get or create broadcast channel for this route
    let mut rx = {
        let mut channels = state.ws_channels.write().await;
        let tx = channels
            .entry(route_id)
            .or_insert_with(|| {
                tracing::debug!(route_id = %route_id, "creating new broadcast channel");
                broadcast::channel(64).0
            });
        tx.subscribe()
    };

    tracing::info!(
        route_id = %route_id,
        user_id = %user_id,
        "WS client connected"
    );

    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Ok(payload) => {
                        tracing::debug!(
                            route_id = %route_id,
                            user_id = %user_id,
                            "sending photo update to WS client"
                        );
                        if ws_sender.send(Message::Text(payload.into())).await.is_err() {
                            tracing::info!(
                                route_id = %route_id,
                                user_id = %user_id,
                                "WS send failed, client disconnected"
                            );
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!(
                            route_id = %route_id,
                            user_id = %user_id,
                            lagged = n,
                            "WS client lagged, some messages were skipped"
                        );
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        tracing::debug!(
                            route_id = %route_id,
                            user_id = %user_id,
                            "broadcast channel closed"
                        );
                        break;
                    }
                }
            }
            msg = ws_receiver.next() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => {
                        tracing::info!(
                            route_id = %route_id,
                            user_id = %user_id,
                            "WS client disconnected"
                        );
                        break;
                    }
                    Some(Err(e)) => {
                        tracing::debug!(
                            route_id = %route_id,
                            user_id = %user_id,
                            error = %e,
                            "WS receive error"
                        );
                        break;
                    }
                    // Ignore other messages (Ping/Pong handled by axum, Text/Binary ignored)
                    Some(Ok(_)) => {}
                }
            }
        }
    }

    // Cleanup: if no more receivers, remove the channel
    let mut channels = state.ws_channels.write().await;
    if let Some(tx) = channels.get(&route_id) {
        if tx.receiver_count() == 0 {
            channels.remove(&route_id);
            tracing::debug!(
                route_id = %route_id,
                "removed empty broadcast channel"
            );
        }
    }
}
