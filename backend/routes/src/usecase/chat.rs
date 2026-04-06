use futures::Stream;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::domain::chat_message::{ChatMessage, ConversationSummary};
use crate::usecase::ai_client::{AiChatClient, AiMessage, AiRole, AiTool};
use crate::usecase::contracts::{ChatMessageRepository, RouteRepository};
use crate::usecase::error::UsecaseError;

const SYSTEM_PROMPT: &str = r#"You are a helpful route planning assistant for the Guide Helper application.
You help users find routes, plan trips, search the route catalog, and answer questions about places.
Always respond in the same language the user writes in.

You have access to these tools:
- geocode: Look up coordinates for any place name or address. Calling this tool automatically displays the location as a marker on the interactive map.
- search_routes: Search the route catalog for shared routes by text query, category, or sort order.
- get_route_details: Get detailed information about a specific route by its ID.
- navigate: Open a specific page in the application (map, profile/settings, route catalog, admin panel).

Rules for tool usage — follow these strictly:
1. When the user asks to SHOW, FIND, MARK, or DISPLAY a location — call geocode for that location.
2. When the user asks to BUILD A ROUTE, PLAN A TRIP, or GO FROM one place TO another — call geocode for EACH location mentioned (start, end, and any waypoints), then describe the route between them. Do NOT give text-only directions; always geocode the places first.
3. When the user asks to search or browse routes in the catalog — use search_routes.
4. When the user mentions a specific route ID — use get_route_details.
5. NEVER say you cannot display maps or show locations on the map. You CAN show locations by calling the geocode tool — it will place markers on the map automatically.
6. If the user names two or more places, call geocode separately for each one.
7. When the user says anything that means OPENING or NAVIGATING to a section of this app — ALWAYS call navigate immediately without asking for clarification. Do not ask "what do you want to configure" — just navigate.

Page mapping (use navigate tool with these paths):
- /profile → when user says: "открой профиль", "профиль", "настройки", "открой настройки", "open settings", "go to profile", "мои настройки", "мой профиль", "settings", "profile"
- /map → when user says: "открой карту", "перейди на карту", "на карту", "go to map", "open map", "карта"
- /explore → when user says: "открой каталог", "каталог маршрутов", "explore", "посмотреть маршруты", "open catalog", "route catalog"
- /admin → when user says: "открой админку", "панель администратора", "admin", "admin panel", "администрирование"

CRITICAL: For ALL navigation requests, call navigate IMMEDIATELY. Never ask clarifying questions about navigation. If the user wants to open any page or section, use the navigate tool.

Be concise and helpful. After calling tools, summarize the results naturally."#;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ChatAction {
    #[serde(rename = "show_points")]
    ShowPoints { points: Vec<ChatPoint> },
    #[serde(rename = "show_routes")]
    ShowRoutes { routes: Vec<ChatRouteRef> },
    #[serde(rename = "navigate")]
    Navigate { path: String, label: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatPoint {
    pub lat: f64,
    pub lng: f64,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRouteRef {
    pub id: String,
    pub name: String,
    pub category_ids: Vec<Uuid>,
    pub avg_rating: f64,
    pub likes_count: i64,
}

#[derive(Debug, Serialize)]
pub struct ChatResponse {
    pub id: Uuid,
    pub message: String,
    pub actions: Vec<ChatAction>,
    pub conversation_id: Uuid,
}

#[derive(Debug)]
struct DirectChatResponse {
    message: String,
    actions: Vec<ChatAction>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DirectRouteRequest {
    display_places: Vec<String>,
    geocoding_queries: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DirectLocationRequest {
    display_name: String,
    geocoding_query: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum ChatStreamEvent {
    #[serde(rename = "token")]
    Token { content: String },
    #[serde(rename = "actions")]
    Actions { actions: Vec<ChatAction> },
    #[serde(rename = "done")]
    Done { id: Uuid, conversation_id: Uuid },
    #[serde(rename = "error")]
    Error { message: String },
}

pub struct ChatUseCase<CM, R>
where
    CM: ChatMessageRepository,
    R: RouteRepository,
{
    chat_repo: CM,
    route_repo: R,
    assistant: Option<Arc<dyn AiChatClient>>,
    http_client: reqwest::Client,
    nominatim_url: String,
    max_tool_iterations: usize,
    max_message_length: usize,
}

impl<CM, R> ChatUseCase<CM, R>
where
    CM: ChatMessageRepository,
    R: RouteRepository,
{
    pub fn new(
        chat_repo: CM,
        route_repo: R,
        assistant: Option<Arc<dyn AiChatClient>>,
        nominatim_url: String,
        max_tool_iterations: usize,
        max_message_length: usize,
    ) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("failed to create reqwest client for ChatUseCase");

        tracing::info!(
            %nominatim_url,
            max_tool_iterations,
            max_message_length,
            "ChatUseCase configured"
        );

        Self {
            chat_repo,
            route_repo,
            assistant,
            http_client,
            nominatim_url,
            max_tool_iterations,
            max_message_length,
        }
    }

    pub fn max_message_length(&self) -> usize {
        self.max_message_length
    }

    pub fn is_available(&self) -> bool {
        self.assistant
            .as_ref()
            .map(|assistant| assistant.is_configured())
            .unwrap_or(false)
    }

    pub fn model_name(&self) -> &str {
        self.assistant.as_ref().map(|a| a.model()).unwrap_or("none")
    }

    pub async fn check_health(&self) -> bool {
        match self.assistant.as_ref() {
            Some(client) => client.health_check().await,
            None => {
                tracing::debug!("health check: AI assistant not configured");
                false
            }
        }
    }

    #[tracing::instrument(skip(self, text), fields(user_id = %user_id, conversation_id = %conversation_id))]
    pub async fn send_message(
        &self,
        user_id: Uuid,
        conversation_id: Uuid,
        text: String,
    ) -> Result<ChatResponse, UsecaseError> {
        tracing::info!(%user_id, %conversation_id, "processing chat message");

        let direct_response = self.try_handle_direct_request(&text).await?;

        let assistant = if direct_response.is_none() {
            Some(self.assistant.as_ref().ok_or_else(|| {
                UsecaseError::Unavailable("AI assistant is not available".to_string())
            })?)
        } else {
            None
        };

        let user_msg = ChatMessage::new_user_message(user_id, conversation_id, text);
        self.chat_repo.create(&user_msg).await?;
        tracing::debug!(message_id = %user_msg.id, "user message saved");

        if let Some(response) = direct_response {
            tracing::info!(
                actions_count = response.actions.len(),
                "handled chat message via direct route fallback"
            );
            return self
                .persist_assistant_response(
                    user_id,
                    conversation_id,
                    response.message,
                    response.actions,
                )
                .await;
        }

        let assistant =
            assistant.expect("assistant must exist when no direct response is available");

        let history = self
            .chat_repo
            .find_by_conversation(user_id, conversation_id, 20)
            .await?;
        tracing::debug!(history_count = history.len(), "loaded conversation history");

        let mut messages = vec![AiMessage {
            role: AiRole::System,
            content: Some(SYSTEM_PROMPT.to_string()),
            tool_calls: vec![],
            tool_call_id: None,
        }];
        for msg in &history {
            let role = match msg.role.as_str() {
                "assistant" => AiRole::Assistant,
                _ => AiRole::User,
            };
            messages.push(AiMessage {
                role,
                content: Some(msg.content.clone()),
                tool_calls: vec![],
                tool_call_id: None,
            });
        }

        let tools = build_tools();
        let mut actions: Vec<ChatAction> = Vec::new();

        let ai_timeout = std::time::Duration::from_secs(60);
        let ai_result = tokio::time::timeout(ai_timeout, async {
            for iteration in 0..self.max_tool_iterations {
                tracing::debug!(iteration, provider = %assistant.model(), "sending request to AI");

                let resp = assistant
                    .chat(&messages, &tools)
                    .await
                    .map_err(|e| UsecaseError::Internal(format!("AI request failed: {}", e)))?;

                if !resp.tool_calls.is_empty() {
                    tracing::info!(
                        iteration,
                        tool_count = resp.tool_calls.len(),
                        "LLM requested tool calls"
                    );

                    // Add assistant message with tool_calls
                    messages.push(AiMessage {
                        role: AiRole::Assistant,
                        content: resp.content.clone(),
                        tool_calls: resp.tool_calls.clone(),
                        tool_call_id: None,
                    });

                    // Execute each tool and append results
                    for tool_call in &resp.tool_calls {
                        tracing::info!(
                            iteration,
                            tool_name = %tool_call.name,
                            tool_call_id = %tool_call.id,
                            "executing tool call"
                        );

                        let tool_args = parse_function_arguments(&tool_call.arguments);
                        let (result_text, new_actions) =
                            self.execute_tool(&tool_call.name, &tool_args).await;

                        actions.extend(new_actions);

                        messages.push(AiMessage {
                            role: AiRole::Tool,
                            content: Some(result_text),
                            tool_calls: vec![],
                            tool_call_id: Some(tool_call.id.clone()),
                        });
                    }
                } else {
                    let assistant_text = resp.content.unwrap_or_default();
                    tracing::info!(
                        iteration,
                        response_len = assistant_text.len(),
                        actions_count = actions.len(),
                        "AI returned final text response"
                    );

                    return self
                        .persist_assistant_response(
                            user_id,
                            conversation_id,
                            assistant_text,
                            actions,
                        )
                        .await;
                }
            }

            tracing::warn!(
                "tool-calling loop exhausted after {} iterations",
                self.max_tool_iterations
            );
            Err(UsecaseError::Internal(
                "AI assistant exceeded maximum tool call iterations".to_string(),
            ))
        })
        .await;

        match ai_result {
            Ok(result) => result,
            Err(_) => {
                tracing::error!("AI chat request timed out after 60s");
                Err(UsecaseError::Internal("AI request timed out".to_string()))
            }
        }
    }

    async fn persist_assistant_response(
        &self,
        user_id: Uuid,
        conversation_id: Uuid,
        message: String,
        actions: Vec<ChatAction>,
    ) -> Result<ChatResponse, UsecaseError> {
        let actions_json = if actions.is_empty() {
            None
        } else {
            Some(serde_json::to_value(&actions).map_err(|e| {
                UsecaseError::Internal(format!("failed to serialize actions: {}", e))
            })?)
        };

        let assistant_msg = ChatMessage::new_assistant_message(
            user_id,
            conversation_id,
            message.clone(),
            actions_json,
        );
        self.chat_repo.create(&assistant_msg).await?;
        tracing::debug!(message_id = %assistant_msg.id, "assistant message saved");

        Ok(ChatResponse {
            id: assistant_msg.id,
            message,
            actions,
            conversation_id,
        })
    }

    async fn try_handle_direct_request(
        &self,
        text: &str,
    ) -> Result<Option<DirectChatResponse>, UsecaseError> {
        let is_russian = contains_cyrillic(text);

        if let Some(route_request) = extract_direct_route_request(text) {
            tracing::info!(
                places = ?route_request.display_places,
                geocoding_queries = ?route_request.geocoding_queries,
                "matched direct route request"
            );

            let mut found_points = Vec::new();
            let mut missing_places = Vec::new();

            for (display_place, geocoding_query) in route_request
                .display_places
                .iter()
                .zip(route_request.geocoding_queries.iter())
            {
                match self.geocode_place(geocoding_query).await {
                    Ok(Some(point)) => found_points.push(point),
                    Ok(None) => missing_places.push(display_place.clone()),
                    Err(error) => {
                        tracing::warn!(
                            place = %display_place,
                            query = %geocoding_query,
                            %error,
                            "direct route geocoding failed"
                        );
                        missing_places.push(display_place.clone());
                    }
                }
            }

            if missing_places.is_empty() && found_points.len() >= 2 {
                let summary = route_request.display_places.join(" -> ");
                let message = if is_russian {
                    format!(
                        "Построил маршрут через точки: {}. Маршрут добавлен на карту.",
                        summary
                    )
                } else {
                    format!(
                        "I plotted a route through these points: {}. It has been added to the map.",
                        summary
                    )
                };

                return Ok(Some(DirectChatResponse {
                    message,
                    actions: vec![ChatAction::ShowPoints {
                        points: found_points,
                    }],
                }));
            }

            let missing_summary = missing_places.join(", ");
            if !found_points.is_empty() {
                let message = if is_russian {
                    format!(
                        "Я добавил найденные точки на карту, но не смог найти: {}. Уточните эти названия.",
                        missing_summary
                    )
                } else {
                    format!(
                        "I added the places I could find to the map, but I could not locate: {}. Please clarify those names.",
                        missing_summary
                    )
                };

                return Ok(Some(DirectChatResponse {
                    message,
                    actions: vec![ChatAction::ShowPoints {
                        points: found_points,
                    }],
                }));
            }

            let message = if is_russian {
                format!(
                    "Не удалось найти на карте: {}. Уточните названия мест.",
                    missing_summary
                )
            } else {
                format!(
                    "I could not find these places on the map: {}. Please clarify the place names.",
                    missing_summary
                )
            };

            return Ok(Some(DirectChatResponse {
                message,
                actions: vec![],
            }));
        }

        let Some(location_request) = extract_direct_location_request(text) else {
            return Ok(None);
        };

        tracing::info!(
            place = %location_request.display_name,
            query = %location_request.geocoding_query,
            "matched direct location request"
        );

        let direct_response = match self.geocode_place(&location_request.geocoding_query).await {
            Ok(Some(point)) => {
                let message = if is_russian {
                    format!("Нашёл место: {}. Добавил его на карту.", point.name)
                } else {
                    format!("I found this place: {}. I added it to the map.", point.name)
                };

                DirectChatResponse {
                    message,
                    actions: vec![ChatAction::ShowPoints {
                        points: vec![point],
                    }],
                }
            }
            Ok(None) => {
                let message = if is_russian {
                    format!(
                        "Не удалось найти на карте: {}. Уточните название или адрес.",
                        location_request.display_name
                    )
                } else {
                    format!(
                        "I could not find this place on the map: {}. Please clarify the name or address.",
                        location_request.display_name
                    )
                };

                DirectChatResponse {
                    message,
                    actions: vec![],
                }
            }
            Err(error) => {
                tracing::warn!(
                    place = %location_request.display_name,
                    query = %location_request.geocoding_query,
                    %error,
                    "direct location geocoding failed"
                );

                let message = if is_russian {
                    format!(
                        "Не удалось найти на карте: {}. Уточните название или адрес.",
                        location_request.display_name
                    )
                } else {
                    format!(
                        "I could not find this place on the map: {}. Please clarify the name or address.",
                        location_request.display_name
                    )
                };

                DirectChatResponse {
                    message,
                    actions: vec![],
                }
            }
        };

        Ok(Some(direct_response))
    }

    #[tracing::instrument(skip(self, text), fields(user_id = %user_id, conversation_id = %conversation_id))]
    pub async fn send_message_stream(
        &self,
        user_id: Uuid,
        conversation_id: Uuid,
        text: String,
    ) -> Result<
        (
            ChatResponse,
            std::pin::Pin<Box<dyn Stream<Item = Result<ChatStreamEvent, UsecaseError>> + Send>>,
        ),
        UsecaseError,
    > {
        // Run full non-streaming call first (tool loop + final answer)
        let response = self.send_message(user_id, conversation_id, text).await?;

        tracing::info!(
            response_id = %response.id,
            response_len = response.message.len(),
            "streaming buffered response"
        );

        let actions = response.actions.clone();
        let message_id = response.id;
        let conv_id = response.conversation_id;

        // Split response text into word-level chunks for progressive rendering
        let chunks: Vec<String> = response
            .message
            .split_inclusive(char::is_whitespace)
            .map(String::from)
            .collect();

        let stream = async_stream::try_stream! {
            // Emit actions first
            if !actions.is_empty() {
                yield ChatStreamEvent::Actions { actions };
            }

            // Stream tokens progressively
            for chunk in chunks {
                yield ChatStreamEvent::Token { content: chunk };
            }

            // Done
            yield ChatStreamEvent::Done {
                id: message_id,
                conversation_id: conv_id,
            };
        };

        Ok((response, Box::pin(stream)))
    }

    async fn execute_tool(
        &self,
        name: &str,
        args: &std::collections::HashMap<String, serde_json::Value>,
    ) -> (String, Vec<ChatAction>) {
        metrics::counter!("chat_tool_calls_total", "tool" => name.to_string()).increment(1);

        match name {
            "geocode" => self.tool_geocode(args).await,
            "search_routes" => self.tool_search_routes(args).await,
            "get_route_details" => self.tool_get_route_details(args).await,
            "navigate" => self.tool_navigate(args).await,
            _ => {
                tracing::warn!(%name, "unknown tool called");
                (
                    format!(
                        "Unknown tool '{}'. Only these tools exist: geocode, search_routes, get_route_details, navigate. Do NOT use any other tools.",
                        name
                    ),
                    vec![],
                )
            }
        }
    }

    async fn tool_geocode(
        &self,
        args: &std::collections::HashMap<String, serde_json::Value>,
    ) -> (String, Vec<ChatAction>) {
        let query = args
            .get("query")
            .and_then(|v| v.as_str())
            .unwrap_or_default();

        tracing::info!(%query, "executing geocode tool");

        match self.geocode_place(query).await {
            Ok(Some(point)) => {
                tracing::info!(
                    %query,
                    lat = point.lat,
                    lng = point.lng,
                    display_name = %point.name,
                    "geocode result found"
                );

                let action = ChatAction::ShowPoints {
                    points: vec![point.clone()],
                };

                (
                    serde_json::json!({
                        "lat": point.lat,
                        "lng": point.lng,
                        "display_name": point.name
                    })
                    .to_string(),
                    vec![action],
                )
            }
            Ok(None) => {
                tracing::info!(%query, "no geocode results found");
                ("No results found for this query.".to_string(), vec![])
            }
            Err(e) => {
                tracing::error!(%query, error = %e, "geocode request failed");
                (format!("Geocoding failed: {}", e), vec![])
            }
        }
    }

    async fn geocode_place(&self, query: &str) -> Result<Option<ChatPoint>, String> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(None);
        }

        let url = format!(
            "{}/search?q={}&format=json&limit=1",
            self.nominatim_url,
            urlencoding::encode(query)
        );

        let response = self
            .http_client
            .get(&url)
            .header("User-Agent", "GuideHelper/1.0")
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err(format!("unexpected geocoding status {}", response.status()));
        }

        let results = response
            .json::<Vec<NominatimResult>>()
            .await
            .map_err(|e| e.to_string())?;

        Ok(results.first().map(|result| ChatPoint {
            lat: result.lat.parse().unwrap_or(0.0),
            lng: result.lon.parse().unwrap_or(0.0),
            name: result.display_name.clone(),
        }))
    }

    async fn tool_search_routes(
        &self,
        args: &std::collections::HashMap<String, serde_json::Value>,
    ) -> (String, Vec<ChatAction>) {
        let search = args.get("query").and_then(|v| v.as_str()).map(String::from);
        let category_id = args
            .get("category_id")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok());
        let sort = args
            .get("sort")
            .and_then(|v| v.as_str())
            .unwrap_or("newest");
        let limit = args
            .get("limit")
            .and_then(|v| v.as_i64())
            .unwrap_or(5)
            .min(10);

        tracing::info!(?search, ?category_id, %sort, %limit, "executing search_routes tool");

        let order_clause = match sort {
            "oldest" => "r.created_at ASC",
            "popular" => "likes_count DESC, r.created_at DESC",
            "top_rated" => "avg_rating DESC, ratings_count DESC, r.created_at DESC",
            _ => "r.created_at DESC",
        };

        match self
            .route_repo
            .explore_shared(search, category_id, None, order_clause, limit, 0)
            .await
        {
            Ok(routes) => {
                tracing::info!(count = routes.len(), "search_routes found results");

                let route_refs: Vec<ChatRouteRef> = routes
                    .iter()
                    .map(|r| ChatRouteRef {
                        id: r.id.to_string(),
                        name: r.name.clone(),
                        category_ids: r.category_ids.clone(),
                        avg_rating: r.avg_rating,
                        likes_count: r.likes_count,
                    })
                    .collect();

                let result_text = serde_json::to_string(&route_refs).unwrap_or_default();
                let actions = if route_refs.is_empty() {
                    vec![]
                } else {
                    vec![ChatAction::ShowRoutes { routes: route_refs }]
                };

                (result_text, actions)
            }
            Err(e) => {
                tracing::error!(error = %e, "search_routes tool failed");
                (format!("Failed to search routes: {}", e), vec![])
            }
        }
    }

    async fn tool_get_route_details(
        &self,
        args: &std::collections::HashMap<String, serde_json::Value>,
    ) -> (String, Vec<ChatAction>) {
        let route_id_str = args
            .get("route_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default();

        tracing::info!(%route_id_str, "executing get_route_details tool");

        let route_id = match Uuid::parse_str(route_id_str) {
            Ok(id) => id,
            Err(e) => {
                tracing::warn!(%route_id_str, error = %e, "invalid route_id");
                return (format!("Invalid route ID: {}", route_id_str), vec![]);
            }
        };

        match self.route_repo.find_by_id(route_id).await {
            Ok(Some(route)) => {
                tracing::info!(%route_id, name = %route.name, "route details found");

                let result = serde_json::json!({
                    "id": route.id,
                    "name": route.name,
                    "points_count": route.points.len(),
                    "category_ids": route.category_ids,
                    "created_at": route.created_at.to_rfc3339(),
                    "is_shared": route.share_token.is_some(),
                });

                (result.to_string(), vec![])
            }
            Ok(None) => {
                tracing::info!(%route_id, "route not found");
                ("Route not found.".to_string(), vec![])
            }
            Err(e) => {
                tracing::error!(%route_id, error = %e, "failed to get route details");
                (format!("Failed to get route: {}", e), vec![])
            }
        }
    }

    async fn tool_navigate(
        &self,
        args: &std::collections::HashMap<String, serde_json::Value>,
    ) -> (String, Vec<ChatAction>) {
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or_default();

        tracing::info!(%path, "executing navigate tool");

        let allowed: &[(&str, &str)] = &[
            ("/map", "Map"),
            ("/profile", "Profile & Settings"),
            ("/explore", "Route Catalog"),
            ("/admin", "Admin Panel"),
        ];

        if let Some(&(p, label)) = allowed.iter().find(|(p, _)| *p == path) {
            tracing::info!(%path, %label, "navigate action created");
            (
                format!("Navigating to {}", label),
                vec![ChatAction::Navigate {
                    path: p.to_string(),
                    label: label.to_string(),
                }],
            )
        } else {
            tracing::warn!(%path, "navigate called with unknown path");
            (
                format!(
                    "Unknown page '{}'. Available: /map, /profile, /explore, /admin",
                    path
                ),
                vec![],
            )
        }
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, conversation_id = %conversation_id))]
    pub async fn get_history(
        &self,
        user_id: Uuid,
        conversation_id: Uuid,
    ) -> Result<Vec<ChatMessage>, UsecaseError> {
        tracing::debug!("getting chat history");

        let messages = self
            .chat_repo
            .find_by_conversation(user_id, conversation_id, 100)
            .await?;

        tracing::debug!(count = messages.len(), "chat history retrieved");
        Ok(messages)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id))]
    pub async fn list_conversations(
        &self,
        user_id: Uuid,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<ConversationSummary>, UsecaseError> {
        tracing::debug!(%limit, %offset, "listing conversations");

        let conversations = self
            .chat_repo
            .list_conversations(user_id, limit, offset)
            .await?;

        tracing::debug!(count = conversations.len(), "conversations listed");
        Ok(conversations)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id))]
    pub async fn count_conversations(&self, user_id: Uuid) -> Result<i64, UsecaseError> {
        tracing::debug!("counting conversations");

        let count = self.chat_repo.count_conversations(user_id).await?;

        tracing::debug!(count, "conversations counted");
        Ok(count)
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, message_id = %message_id))]
    pub async fn delete_message(
        &self,
        user_id: Uuid,
        message_id: Uuid,
    ) -> Result<(), UsecaseError> {
        tracing::info!("deleting message");

        self.chat_repo.delete_message(user_id, message_id).await?;

        tracing::info!("message deleted");
        Ok(())
    }

    #[tracing::instrument(skip(self), fields(user_id = %user_id, conversation_id = %conversation_id))]
    pub async fn delete_conversation(
        &self,
        user_id: Uuid,
        conversation_id: Uuid,
    ) -> Result<(), UsecaseError> {
        tracing::info!("deleting conversation");

        self.chat_repo
            .delete_conversation(user_id, conversation_id)
            .await?;

        tracing::info!("conversation deleted");
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
struct NominatimResult {
    lat: String,
    lon: String,
    display_name: String,
}

fn build_tools() -> Vec<AiTool> {
    vec![
        AiTool {
            name: "geocode".to_string(),
            description: "Geocode a place name or address to get its latitude and longitude. Calling this tool places a marker for the location on the interactive map. Call it once per location when building routes or showing places.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The place name or address to geocode"
                    }
                },
                "required": ["query"]
            }),
        },
        AiTool {
            name: "search_routes".to_string(),
            description: "Search the route catalog for shared routes. Can filter by text query, category UUID, and sort order.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Text search query for route names"
                    },
                    "category_id": {
                        "type": "string",
                        "description": "Filter by category UUID"
                    },
                    "sort": {
                        "type": "string",
                        "enum": ["newest", "oldest", "popular", "top_rated"],
                        "description": "Sort order for results"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of results (1-10)"
                    }
                },
                "required": []
            }),
        },
        AiTool {
            name: "get_route_details".to_string(),
            description: "Get detailed information about a specific route by its ID.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "route_id": {
                        "type": "string",
                        "description": "The UUID of the route"
                    }
                },
                "required": ["route_id"]
            }),
        },
        AiTool {
            name: "navigate".to_string(),
            description: "Navigate to a specific page in the application. Use when the user asks to open, go to, or navigate to a page.".to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "enum": ["/map", "/profile", "/explore", "/admin"],
                        "description": "Page path: /map (main map), /profile (profile & settings), /explore (route catalog), /admin (admin panel)"
                    }
                },
                "required": ["path"]
            }),
        },
    ]
}

fn parse_function_arguments(input: &str) -> std::collections::HashMap<String, serde_json::Value> {
    match serde_json::from_str::<serde_json::Value>(input) {
        Ok(serde_json::Value::Object(map)) => map.into_iter().collect(),
        Ok(_) => {
            tracing::warn!(raw = %input, "function arguments are not an object");
            std::collections::HashMap::new()
        }
        Err(e) => {
            tracing::warn!(error = %e, raw = %input, "failed to parse function arguments");
            std::collections::HashMap::new()
        }
    }
}

fn extract_route_locations(text: &str) -> Option<Vec<String>> {
    extract_direct_route_request(text).map(|request| request.display_places)
}

fn extract_direct_location_request(text: &str) -> Option<DirectLocationRequest> {
    let normalized = normalize_whitespace(text);
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lowered = trimmed.to_lowercase();
    let prefixes = [
        "найди на карте ",
        "покажи на карте ",
        "отметь на карте ",
        "найди ",
        "покажи ",
        "отметь ",
        "где ",
        "find ",
        "show ",
        "mark ",
        "where is ",
        "locate ",
    ];

    for prefix in prefixes {
        if let Some(rest) = lowered.strip_prefix(prefix) {
            let raw_start = trimmed.len() - rest.len();
            let place = trim_place_name(&trimmed[raw_start..]);
            if place.is_empty() {
                return None;
            }

            return Some(DirectLocationRequest {
                display_name: place.clone(),
                geocoding_query: place,
            });
        }
    }

    None
}

fn extract_direct_route_request(text: &str) -> Option<DirectRouteRequest> {
    let normalized = format!(" {} ", normalize_whitespace(text).to_lowercase());
    let patterns = [
        (" от ", " до "),
        (" из ", " до "),
        (" из ", " в "),
        (" from ", " to "),
    ];

    for (from_token, to_token) in patterns {
        let Some(from_idx) = normalized.find(from_token) else {
            continue;
        };

        let after_from = &normalized[from_idx + from_token.len()..];
        let Some(to_idx) = after_from.rfind(to_token) else {
            continue;
        };

        let start_and_waypoints = trim_place_name(&after_from[..to_idx]);
        let end = trim_place_name(&after_from[to_idx + to_token.len()..]);

        if start_and_waypoints.is_empty() || end.is_empty() {
            continue;
        }

        let mut display_places = split_place_list(&start_and_waypoints);
        display_places.push(end);
        display_places.retain(|place| !place.is_empty());

        if display_places.len() >= 2 {
            let context = extract_route_context(&normalized[..from_idx]);
            let geocoding_queries = display_places
                .iter()
                .map(|place| enrich_place_with_context(place, context.as_deref()))
                .collect();

            return Some(DirectRouteRequest {
                display_places,
                geocoding_queries,
            });
        }
    }

    None
}

fn extract_route_context(prefix: &str) -> Option<String> {
    let trimmed = prefix.trim();
    for token in [" в ", " in "] {
        if let Some(idx) = trimmed.rfind(token) {
            let context = trim_place_name(&trimmed[idx + token.len()..]);
            if !context.is_empty() {
                return Some(context);
            }
        }
    }
    None
}

fn enrich_place_with_context(place: &str, context: Option<&str>) -> String {
    let Some(context) = context.map(str::trim).filter(|value| !value.is_empty()) else {
        return place.to_string();
    };

    let place_lower = place.to_lowercase();
    let context_lower = context.to_lowercase();
    if place_lower.contains(&context_lower) {
        place.to_string()
    } else {
        format!("{}, {}", place, context)
    }
}

fn normalize_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn split_place_list(input: &str) -> Vec<String> {
    input
        .replace(" через ", ",")
        .replace(" via ", ",")
        .replace(" и ", ",")
        .replace(" and ", ",")
        .split(',')
        .map(trim_place_name)
        .filter(|value| !value.is_empty())
        .collect()
}

fn trim_place_name(input: &str) -> String {
    input
        .trim_matches(|c: char| {
            c.is_whitespace()
                || matches!(
                    c,
                    ',' | '.' | '!' | '?' | ':' | ';' | '"' | '\'' | '(' | ')' | '[' | ']'
                )
        })
        .to_string()
}

fn contains_cyrillic(text: &str) -> bool {
    text.chars()
        .any(|ch| ('\u{0400}'..='\u{04FF}').contains(&ch))
}

// Need urlencoding for Nominatim queries
mod urlencoding {
    pub fn encode(input: &str) -> String {
        let mut result = String::new();
        for byte in input.bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    result.push(byte as char);
                }
                _ => {
                    result.push_str(&format!("%{:02X}", byte));
                }
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::chat_message::ChatMessage;
    use crate::domain::route::{ExploreRouteRow, Route};
    use crate::repository::errors::RepositoryError;
    use crate::usecase::ai_client::AiChatClient;
    use crate::usecase::contracts::{MockChatMessageRepository, MockRouteRepository};
    use crate::usecase::openai::OpenAIClient;
    use std::collections::HashMap;
    use std::sync::Arc;

    fn make_usecase(
        chat_repo: MockChatMessageRepository,
        route_repo: MockRouteRepository,
        with_assistant: bool,
    ) -> ChatUseCase<MockChatMessageRepository, MockRouteRepository> {
        let assistant = if with_assistant {
            Some(Arc::new(OpenAIClient::new(
                "https://api.openai.com/v1".to_string(),
                "test-model".to_string(),
                Some("test-key".to_string()),
            )) as Arc<dyn AiChatClient>)
        } else {
            None
        };
        ChatUseCase::new(
            chat_repo,
            route_repo,
            assistant,
            "https://nominatim.openstreetmap.org".to_string(),
            5,
            2000,
        )
    }

    // --- is_available ---

    #[test]
    fn test_is_available_without_assistant() {
        let uc = make_usecase(
            MockChatMessageRepository::new(),
            MockRouteRepository::new(),
            false,
        );
        assert!(!uc.is_available());
    }

    #[test]
    fn test_is_available_with_assistant() {
        let uc = make_usecase(
            MockChatMessageRepository::new(),
            MockRouteRepository::new(),
            true,
        );
        assert!(uc.is_available());
    }

    // --- send_message without assistant ---

    #[tokio::test]
    async fn test_send_message_no_assistant_returns_error() {
        let uc = make_usecase(
            MockChatMessageRepository::new(),
            MockRouteRepository::new(),
            false,
        );
        let result = uc
            .send_message(Uuid::new_v4(), Uuid::new_v4(), "hi".to_string())
            .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not available"));
    }

    #[test]
    fn test_extract_route_locations_from_russian_query() {
        let places = extract_route_locations("построй маршрут от владивостока до самары").unwrap();
        assert_eq!(places, vec!["владивостока", "самары"]);
    }

    #[test]
    fn test_extract_route_locations_with_waypoints() {
        let places =
            extract_route_locations("построй маршрут от владивостока через уфу и казань до самары")
                .unwrap();
        assert_eq!(places, vec!["владивостока", "уфу", "казань", "самары"]);
    }

    #[test]
    fn test_extract_route_locations_with_city_context_and_iz_do_form() {
        let places = extract_route_locations(
            "построй маршрут в москве из улицы бультерова до улицы куликовская",
        )
        .unwrap();
        assert_eq!(places, vec!["улицы бультерова", "улицы куликовская"]);
    }

    #[test]
    fn test_extract_direct_route_request_enriches_queries_with_context() {
        let request = extract_direct_route_request(
            "построй маршрут в москве из улицы бультерова до улицы куликовская",
        )
        .unwrap();

        assert_eq!(
            request.display_places,
            vec!["улицы бультерова", "улицы куликовская"]
        );
        assert_eq!(
            request.geocoding_queries,
            vec!["улицы бультерова, москве", "улицы куликовская, москве"]
        );
    }

    #[test]
    fn test_extract_direct_location_request_from_russian_query() {
        let request = extract_direct_location_request("найди бутлерова 2к2").unwrap();
        assert_eq!(request.display_name, "бутлерова 2к2");
        assert_eq!(request.geocoding_query, "бутлерова 2к2");
    }

    #[test]
    fn test_extract_direct_location_request_from_where_query() {
        let request = extract_direct_location_request("где москва-сити").unwrap();
        assert_eq!(request.display_name, "москва-сити");
    }

    #[tokio::test]
    async fn test_send_message_direct_route_request_returns_points_without_assistant() {
        let mock_server = wiremock::MockServer::start().await;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/search"))
            .and(wiremock::matchers::query_param("q", "владивостока"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!([{
                    "lat": "43.1155",
                    "lon": "131.8855",
                    "display_name": "Vladivostok, Russia"
                }])),
            )
            .mount(&mock_server)
            .await;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/search"))
            .and(wiremock::matchers::query_param("q", "самары"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!([{
                    "lat": "53.1959",
                    "lon": "50.1008",
                    "display_name": "Samara, Russia"
                }])),
            )
            .mount(&mock_server)
            .await;

        let mut mock_chat = MockChatMessageRepository::new();
        mock_chat.expect_create().times(2).returning(|_| Ok(()));

        let uc =
            make_usecase_with_nominatim(mock_chat, MockRouteRepository::new(), mock_server.uri());

        let result = uc
            .send_message(
                Uuid::new_v4(),
                Uuid::new_v4(),
                "построй маршрут от владивостока до самары".to_string(),
            )
            .await
            .unwrap();

        assert!(result.message.contains("Маршрут добавлен на карту"));
        assert_eq!(result.actions.len(), 1);

        match &result.actions[0] {
            ChatAction::ShowPoints { points } => {
                assert_eq!(points.len(), 2);
                assert!(points[0].name.contains("Vladivostok"));
                assert!(points[1].name.contains("Samara"));
            }
            _ => panic!("expected ShowPoints action"),
        }
    }

    #[tokio::test]
    async fn test_send_message_direct_route_request_uses_city_context_for_geocoding() {
        let mock_server = wiremock::MockServer::start().await;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/search"))
            .and(wiremock::matchers::query_param(
                "q",
                "улицы бультерова, москве",
            ))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!([{
                    "lat": "55.6200",
                    "lon": "37.6400",
                    "display_name": "улица Бутлерова, Москва, Россия"
                }])),
            )
            .mount(&mock_server)
            .await;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/search"))
            .and(wiremock::matchers::query_param(
                "q",
                "улицы куликовская, москве",
            ))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!([{
                    "lat": "55.5600",
                    "lon": "37.5600",
                    "display_name": "Куликовская улица, Москва, Россия"
                }])),
            )
            .mount(&mock_server)
            .await;

        let mut mock_chat = MockChatMessageRepository::new();
        mock_chat.expect_create().times(2).returning(|_| Ok(()));

        let uc =
            make_usecase_with_nominatim(mock_chat, MockRouteRepository::new(), mock_server.uri());

        let result = uc
            .send_message(
                Uuid::new_v4(),
                Uuid::new_v4(),
                "построй маршрут в москве из улицы бультерова до улицы куликовская".to_string(),
            )
            .await
            .unwrap();

        assert!(result.message.contains("Маршрут добавлен на карту"));
        assert_eq!(result.actions.len(), 1);

        match &result.actions[0] {
            ChatAction::ShowPoints { points } => {
                assert_eq!(points.len(), 2);
                assert!(points[0].name.contains("Москва"));
                assert!(points[1].name.contains("Москва"));
            }
            _ => panic!("expected ShowPoints action"),
        }
    }

    #[tokio::test]
    async fn test_send_message_direct_location_request_returns_point_without_assistant() {
        let mock_server = wiremock::MockServer::start().await;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/search"))
            .and(wiremock::matchers::query_param("q", "бутлерова 2к2"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!([{
                    "lat": "55.6495",
                    "lon": "37.5408",
                    "display_name": "улица Бутлерова, 2к2, Москва, Россия"
                }])),
            )
            .mount(&mock_server)
            .await;

        let mut mock_chat = MockChatMessageRepository::new();
        mock_chat.expect_create().times(2).returning(|_| Ok(()));

        let uc =
            make_usecase_with_nominatim(mock_chat, MockRouteRepository::new(), mock_server.uri());

        let result = uc
            .send_message(
                Uuid::new_v4(),
                Uuid::new_v4(),
                "найди бутлерова 2к2".to_string(),
            )
            .await
            .unwrap();

        assert!(result.message.contains("Добавил"));
        assert_eq!(result.actions.len(), 1);

        match &result.actions[0] {
            ChatAction::ShowPoints { points } => {
                assert_eq!(points.len(), 1);
                assert!(points[0].name.contains("Бутлерова"));
            }
            _ => panic!("expected ShowPoints action"),
        }
    }

    // --- get_history ---

    #[tokio::test]
    async fn test_get_history_returns_messages() {
        let mut mock_chat = MockChatMessageRepository::new();
        let user_id = Uuid::new_v4();
        let conv_id = Uuid::new_v4();

        let msg = ChatMessage::new_user_message(user_id, conv_id, "hello".to_string());
        let msgs = vec![msg];

        mock_chat
            .expect_find_by_conversation()
            .with(
                mockall::predicate::eq(user_id),
                mockall::predicate::eq(conv_id),
                mockall::predicate::eq(100i64),
            )
            .times(1)
            .return_once(move |_, _, _| Ok(msgs));

        let uc = make_usecase(mock_chat, MockRouteRepository::new(), false);
        let result = uc.get_history(user_id, conv_id).await;

        assert!(result.is_ok());
        let messages = result.unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "hello");
    }

    #[tokio::test]
    async fn test_get_history_empty() {
        let mut mock_chat = MockChatMessageRepository::new();
        let user_id = Uuid::new_v4();
        let conv_id = Uuid::new_v4();

        mock_chat
            .expect_find_by_conversation()
            .times(1)
            .return_once(|_, _, _| Ok(vec![]));

        let uc = make_usecase(mock_chat, MockRouteRepository::new(), false);
        let result = uc.get_history(user_id, conv_id).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_get_history_repo_error() {
        let mut mock_chat = MockChatMessageRepository::new();

        mock_chat
            .expect_find_by_conversation()
            .times(1)
            .return_once(|_, _, _| Err(RepositoryError::NotFound));

        let uc = make_usecase(mock_chat, MockRouteRepository::new(), false);
        let result = uc.get_history(Uuid::new_v4(), Uuid::new_v4()).await;

        assert!(result.is_err());
    }

    // --- execute_tool ---

    #[tokio::test]
    async fn test_execute_tool_unknown_returns_error_text() {
        let uc = make_usecase(
            MockChatMessageRepository::new(),
            MockRouteRepository::new(),
            false,
        );
        let args = HashMap::new();
        let (text, actions) = uc.execute_tool("nonexistent_tool", &args).await;

        assert!(text.contains("Unknown tool"));
        assert!(text.contains("nonexistent_tool"));
        assert!(actions.is_empty());
    }

    // --- tool_search_routes ---

    #[tokio::test]
    async fn test_tool_search_routes_returns_results() {
        let mut mock_route = MockRouteRepository::new();

        let route_id = Uuid::new_v4();
        let rows = vec![ExploreRouteRow {
            id: route_id,
            name: "Test Route".to_string(),
            points_count: 5,
            created_at: chrono::Utc::now(),
            share_token: Uuid::new_v4(),
            likes_count: 10,
            avg_rating: 4.5,
            ratings_count: 3,
            category_ids: vec![],
            seasons: vec![],
        }];

        mock_route
            .expect_explore_shared()
            .times(1)
            .return_once(move |_, _, _, _, _, _| Ok(rows));

        let uc = make_usecase(MockChatMessageRepository::new(), mock_route, false);

        let mut args = HashMap::new();
        args.insert(
            "query".to_string(),
            serde_json::Value::String("test".to_string()),
        );

        let (text, actions) = uc.tool_search_routes(&args).await;

        assert!(text.contains("Test Route"));
        assert_eq!(actions.len(), 1);
        match &actions[0] {
            ChatAction::ShowRoutes { routes } => {
                assert_eq!(routes.len(), 1);
                assert_eq!(routes[0].name, "Test Route");
                assert_eq!(routes[0].likes_count, 10);
            }
            _ => panic!("expected ShowRoutes action"),
        }
    }

    #[tokio::test]
    async fn test_tool_search_routes_empty_results() {
        let mut mock_route = MockRouteRepository::new();

        mock_route
            .expect_explore_shared()
            .times(1)
            .return_once(|_, _, _, _, _, _| Ok(vec![]));

        let uc = make_usecase(MockChatMessageRepository::new(), mock_route, false);

        let args = HashMap::new();
        let (_, actions) = uc.tool_search_routes(&args).await;

        assert!(actions.is_empty());
    }

    #[tokio::test]
    async fn test_tool_search_routes_with_sort_popular() {
        let mut mock_route = MockRouteRepository::new();

        mock_route
            .expect_explore_shared()
            .withf(|_, _, _, order, _, _| order == "likes_count DESC, r.created_at DESC")
            .times(1)
            .return_once(|_, _, _, _, _, _| Ok(vec![]));

        let uc = make_usecase(MockChatMessageRepository::new(), mock_route, false);

        let mut args = HashMap::new();
        args.insert(
            "sort".to_string(),
            serde_json::Value::String("popular".to_string()),
        );

        let _ = uc.tool_search_routes(&args).await;
    }

    #[tokio::test]
    async fn test_tool_search_routes_repo_error() {
        let mut mock_route = MockRouteRepository::new();

        mock_route
            .expect_explore_shared()
            .times(1)
            .return_once(|_, _, _, _, _, _| Err(RepositoryError::NotFound));

        let uc = make_usecase(MockChatMessageRepository::new(), mock_route, false);

        let args = HashMap::new();
        let (text, actions) = uc.tool_search_routes(&args).await;

        assert!(text.contains("Failed to search routes"));
        assert!(actions.is_empty());
    }

    // --- tool_get_route_details ---

    #[tokio::test]
    async fn test_tool_get_route_details_found() {
        let mut mock_route = MockRouteRepository::new();
        let route_id = Uuid::new_v4();

        let route = Route {
            id: route_id,
            user_id: Uuid::new_v4(),
            name: "My Route".to_string(),
            points: vec![],
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            share_token: Some(Uuid::new_v4()),
            category_ids: vec![],
            start_location: None,
            end_location: None,
            seasons: vec![],
            description: None,
        };
        let route_clone = route.clone();

        mock_route
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .return_once(move |_| Ok(Some(route_clone)));

        let uc = make_usecase(MockChatMessageRepository::new(), mock_route, false);

        let mut args = HashMap::new();
        args.insert(
            "route_id".to_string(),
            serde_json::Value::String(route_id.to_string()),
        );

        let (text, actions) = uc.tool_get_route_details(&args).await;

        assert!(text.contains("My Route"));
        assert!(text.contains("is_shared"));
        assert!(actions.is_empty());
    }

    #[tokio::test]
    async fn test_tool_get_route_details_not_found() {
        let mut mock_route = MockRouteRepository::new();
        let route_id = Uuid::new_v4();

        mock_route
            .expect_find_by_id()
            .with(mockall::predicate::eq(route_id))
            .times(1)
            .return_once(|_| Ok(None));

        let uc = make_usecase(MockChatMessageRepository::new(), mock_route, false);

        let mut args = HashMap::new();
        args.insert(
            "route_id".to_string(),
            serde_json::Value::String(route_id.to_string()),
        );

        let (text, actions) = uc.tool_get_route_details(&args).await;

        assert!(text.contains("not found"));
        assert!(actions.is_empty());
    }

    #[tokio::test]
    async fn test_tool_get_route_details_invalid_uuid() {
        let uc = make_usecase(
            MockChatMessageRepository::new(),
            MockRouteRepository::new(),
            false,
        );

        let mut args = HashMap::new();
        args.insert(
            "route_id".to_string(),
            serde_json::Value::String("not-a-uuid".to_string()),
        );

        let (text, actions) = uc.tool_get_route_details(&args).await;

        assert!(text.contains("Invalid route ID"));
        assert!(actions.is_empty());
    }

    #[tokio::test]
    async fn test_tool_get_route_details_missing_arg() {
        let uc = make_usecase(
            MockChatMessageRepository::new(),
            MockRouteRepository::new(),
            false,
        );

        let args = HashMap::new();
        let (text, actions) = uc.tool_get_route_details(&args).await;

        assert!(text.contains("Invalid route ID"));
        assert!(actions.is_empty());
    }

    // --- urlencoding ---

    #[test]
    fn test_urlencoding_ascii() {
        assert_eq!(urlencoding::encode("hello"), "hello");
    }

    #[test]
    fn test_urlencoding_spaces() {
        assert_eq!(urlencoding::encode("hello world"), "hello%20world");
    }

    #[test]
    fn test_urlencoding_cyrillic() {
        let encoded = urlencoding::encode("Москва");
        assert!(!encoded.contains("Москва"));
        assert!(encoded.contains("%"));
    }

    #[test]
    fn test_urlencoding_special_chars() {
        assert_eq!(urlencoding::encode("a&b=c"), "a%26b%3Dc");
    }

    #[test]
    fn test_urlencoding_preserves_unreserved() {
        assert_eq!(urlencoding::encode("a-b_c.d~e"), "a-b_c.d~e");
    }

    // --- build_tools ---

    #[test]
    fn test_build_tools_returns_four_tools() {
        let tools = build_tools();
        assert_eq!(tools.len(), 4);

        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"geocode"));
        assert!(names.contains(&"search_routes"));
        assert!(names.contains(&"get_route_details"));
        assert!(names.contains(&"navigate"));
    }

    #[test]
    fn test_build_tools_all_function_type() {
        let tools = build_tools();
        for tool in &tools {
            assert!(!tool.name.is_empty());
            assert!(!tool.description.is_empty());
            assert!(tool.parameters.is_object());
        }
    }

    // --- tool_navigate ---

    #[tokio::test]
    async fn test_tool_navigate_profile() {
        let uc = make_usecase(
            MockChatMessageRepository::new(),
            MockRouteRepository::new(),
            false,
        );
        let mut args = std::collections::HashMap::new();
        args.insert(
            "path".to_string(),
            serde_json::Value::String("/profile".to_string()),
        );
        let (text, actions) = uc.tool_navigate(&args).await;
        assert!(text.contains("Profile & Settings"));
        assert_eq!(actions.len(), 1);
        match &actions[0] {
            ChatAction::Navigate { path, label } => {
                assert_eq!(path, "/profile");
                assert_eq!(label, "Profile & Settings");
            }
            _ => panic!("expected Navigate action"),
        }
    }

    #[tokio::test]
    async fn test_tool_navigate_unknown_path() {
        let uc = make_usecase(
            MockChatMessageRepository::new(),
            MockRouteRepository::new(),
            false,
        );
        let mut args = std::collections::HashMap::new();
        args.insert(
            "path".to_string(),
            serde_json::Value::String("/unknown".to_string()),
        );
        let (text, actions) = uc.tool_navigate(&args).await;
        assert!(text.contains("Unknown page"));
        assert!(actions.is_empty());
    }

    #[test]
    fn test_chat_action_navigate_serialization() {
        let action = ChatAction::Navigate {
            path: "/profile".to_string(),
            label: "Profile & Settings".to_string(),
        };
        let json = serde_json::to_value(&action).unwrap();
        assert_eq!(json["type"], "navigate");
        assert_eq!(json["path"], "/profile");
        assert_eq!(json["label"], "Profile & Settings");
    }

    // --- ChatAction serialization ---

    #[test]
    fn test_chat_action_show_points_serialization() {
        let action = ChatAction::ShowPoints {
            points: vec![ChatPoint {
                lat: 55.75,
                lng: 37.62,
                name: "Moscow".to_string(),
            }],
        };

        let json = serde_json::to_value(&action).unwrap();
        assert_eq!(json["type"], "show_points");
        assert_eq!(json["points"][0]["name"], "Moscow");
    }

    #[test]
    fn test_chat_action_show_routes_serialization() {
        let action = ChatAction::ShowRoutes {
            routes: vec![ChatRouteRef {
                id: "abc-123".to_string(),
                name: "Trail".to_string(),
                category_ids: vec![],
                avg_rating: 4.2,
                likes_count: 7,
            }],
        };

        let json = serde_json::to_value(&action).unwrap();
        assert_eq!(json["type"], "show_routes");
        assert_eq!(json["routes"][0]["name"], "Trail");
        assert_eq!(json["routes"][0]["likes_count"], 7);
    }

    #[test]
    fn test_chat_response_serialization() {
        let resp = ChatResponse {
            id: Uuid::new_v4(),
            message: "Here are results".to_string(),
            actions: vec![ChatAction::ShowPoints { points: vec![] }],
            conversation_id: Uuid::new_v4(),
        };

        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["message"], "Here are results");
        assert!(json["actions"].is_array());
    }

    // --- list_conversations ---

    #[tokio::test]
    async fn test_list_conversations_empty() {
        let mut mock_chat = MockChatMessageRepository::new();
        let user_id = Uuid::new_v4();

        mock_chat
            .expect_list_conversations()
            .with(
                mockall::predicate::eq(user_id),
                mockall::predicate::eq(20i64),
                mockall::predicate::eq(0i64),
            )
            .times(1)
            .return_once(|_, _, _| Ok(vec![]));

        let uc = make_usecase(mock_chat, MockRouteRepository::new(), false);
        let result = uc.list_conversations(user_id, 20, 0).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_list_conversations_returns_results() {
        let mut mock_chat = MockChatMessageRepository::new();
        let user_id = Uuid::new_v4();
        let conv_id = Uuid::new_v4();

        let summary = ConversationSummary {
            conversation_id: conv_id,
            last_message: "hello".to_string(),
            message_count: 2,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            title: "hello".to_string(),
        };

        mock_chat
            .expect_list_conversations()
            .times(1)
            .return_once(move |_, _, _| Ok(vec![summary]));

        let uc = make_usecase(mock_chat, MockRouteRepository::new(), false);
        let result = uc.list_conversations(user_id, 20, 0).await;

        assert!(result.is_ok());
        let conversations = result.unwrap();
        assert_eq!(conversations.len(), 1);
        assert_eq!(conversations[0].conversation_id, conv_id);
        assert_eq!(conversations[0].last_message, "hello");
        assert_eq!(conversations[0].message_count, 2);
    }

    #[tokio::test]
    async fn test_list_conversations_repo_error() {
        let mut mock_chat = MockChatMessageRepository::new();

        mock_chat
            .expect_list_conversations()
            .times(1)
            .return_once(|_, _, _| Err(RepositoryError::DatabaseError("db error".to_string())));

        let uc = make_usecase(mock_chat, MockRouteRepository::new(), false);
        let result = uc.list_conversations(Uuid::new_v4(), 20, 0).await;

        assert!(result.is_err());
    }

    // --- delete_conversation ---

    #[tokio::test]
    async fn test_delete_conversation_success() {
        let mut mock_chat = MockChatMessageRepository::new();
        let user_id = Uuid::new_v4();
        let conv_id = Uuid::new_v4();

        mock_chat
            .expect_delete_conversation()
            .with(
                mockall::predicate::eq(user_id),
                mockall::predicate::eq(conv_id),
            )
            .times(1)
            .return_once(|_, _| Ok(()));

        let uc = make_usecase(mock_chat, MockRouteRepository::new(), false);
        let result = uc.delete_conversation(user_id, conv_id).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_delete_conversation_not_found() {
        let mut mock_chat = MockChatMessageRepository::new();

        mock_chat
            .expect_delete_conversation()
            .times(1)
            .return_once(|_, _| Err(RepositoryError::NotFound));

        let uc = make_usecase(mock_chat, MockRouteRepository::new(), false);
        let result = uc.delete_conversation(Uuid::new_v4(), Uuid::new_v4()).await;

        assert!(result.is_err());
    }

    // --- tool_geocode with wiremock ---

    fn make_usecase_with_nominatim(
        chat_repo: MockChatMessageRepository,
        route_repo: MockRouteRepository,
        nominatim_url: String,
    ) -> ChatUseCase<MockChatMessageRepository, MockRouteRepository> {
        ChatUseCase::new(chat_repo, route_repo, None, nominatim_url, 5, 2000)
    }

    #[tokio::test]
    async fn test_tool_geocode_success() {
        let mock_server = wiremock::MockServer::start().await;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/search"))
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!([{
                    "lat": "55.7558",
                    "lon": "37.6173",
                    "display_name": "Moscow, Russia"
                }])),
            )
            .mount(&mock_server)
            .await;

        let uc = make_usecase_with_nominatim(
            MockChatMessageRepository::new(),
            MockRouteRepository::new(),
            mock_server.uri(),
        );

        let mut args = HashMap::new();
        args.insert(
            "query".to_string(),
            serde_json::Value::String("Moscow".to_string()),
        );

        let (text, actions) = uc.tool_geocode(&args).await;

        assert!(text.contains("55.7558"));
        assert!(text.contains("37.6173"));
        assert_eq!(actions.len(), 1);
        match &actions[0] {
            ChatAction::ShowPoints { points } => {
                assert_eq!(points.len(), 1);
                assert!((points[0].lat - 55.7558).abs() < 0.001);
                assert!((points[0].lng - 37.6173).abs() < 0.001);
                assert!(points[0].name.contains("Moscow"));
            }
            _ => panic!("expected ShowPoints action"),
        }
    }

    #[tokio::test]
    async fn test_tool_geocode_no_results() {
        let mock_server = wiremock::MockServer::start().await;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/search"))
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!([])))
            .mount(&mock_server)
            .await;

        let uc = make_usecase_with_nominatim(
            MockChatMessageRepository::new(),
            MockRouteRepository::new(),
            mock_server.uri(),
        );

        let mut args = HashMap::new();
        args.insert(
            "query".to_string(),
            serde_json::Value::String("nonexistent_place_xyz".to_string()),
        );

        let (text, actions) = uc.tool_geocode(&args).await;

        assert!(text.contains("No results"));
        assert!(actions.is_empty());
    }

    #[tokio::test]
    async fn test_tool_geocode_server_error() {
        let mock_server = wiremock::MockServer::start().await;

        wiremock::Mock::given(wiremock::matchers::method("GET"))
            .and(wiremock::matchers::path("/search"))
            .respond_with(wiremock::ResponseTemplate::new(500))
            .mount(&mock_server)
            .await;

        let uc = make_usecase_with_nominatim(
            MockChatMessageRepository::new(),
            MockRouteRepository::new(),
            mock_server.uri(),
        );

        let mut args = HashMap::new();
        args.insert(
            "query".to_string(),
            serde_json::Value::String("Moscow".to_string()),
        );

        let (text, actions) = uc.tool_geocode(&args).await;

        assert!(
            text.contains("Failed to parse") || text.contains("Geocoding failed"),
            "unexpected text: {}",
            text
        );
        assert!(actions.is_empty());
    }

    // --- delete_message ---

    #[tokio::test]
    async fn test_delete_message_success() {
        let mut mock_chat = MockChatMessageRepository::new();
        let user_id = Uuid::new_v4();
        let message_id = Uuid::new_v4();

        mock_chat
            .expect_delete_message()
            .with(
                mockall::predicate::eq(user_id),
                mockall::predicate::eq(message_id),
            )
            .times(1)
            .return_once(|_, _| Ok(()));

        let uc = make_usecase(mock_chat, MockRouteRepository::new(), false);
        let result = uc.delete_message(user_id, message_id).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_delete_message_not_found() {
        let mut mock_chat = MockChatMessageRepository::new();

        mock_chat
            .expect_delete_message()
            .times(1)
            .return_once(|_, _| Err(RepositoryError::NotFound));

        let uc = make_usecase(mock_chat, MockRouteRepository::new(), false);
        let result = uc.delete_message(Uuid::new_v4(), Uuid::new_v4()).await;

        assert!(result.is_err());
    }

    // --- count_conversations ---

    #[tokio::test]
    async fn test_count_conversations_empty() {
        let mut mock_chat = MockChatMessageRepository::new();
        let user_id = Uuid::new_v4();

        mock_chat
            .expect_count_conversations()
            .with(mockall::predicate::eq(user_id))
            .times(1)
            .return_once(|_| Ok(0));

        let uc = make_usecase(mock_chat, MockRouteRepository::new(), false);
        let result = uc.count_conversations(user_id).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0);
    }

    #[tokio::test]
    async fn test_count_conversations_returns_count() {
        let mut mock_chat = MockChatMessageRepository::new();
        let user_id = Uuid::new_v4();

        mock_chat
            .expect_count_conversations()
            .with(mockall::predicate::eq(user_id))
            .times(1)
            .return_once(|_| Ok(5));

        let uc = make_usecase(mock_chat, MockRouteRepository::new(), false);
        let result = uc.count_conversations(user_id).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 5);
    }

    // --- max_message_length config ---

    #[test]
    fn test_max_message_length_from_config() {
        let uc = ChatUseCase::new(
            MockChatMessageRepository::new(),
            MockRouteRepository::new(),
            None,
            "https://nominatim.openstreetmap.org".to_string(),
            5,
            500,
        );
        assert_eq!(uc.max_message_length(), 500);
    }

    // --- ChatStreamEvent serialization ---

    #[test]
    fn test_chat_stream_event_token_serialization() {
        let event = ChatStreamEvent::Token {
            content: "hello".to_string(),
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "token");
        assert_eq!(json["content"], "hello");
    }

    #[test]
    fn test_chat_stream_event_done_serialization() {
        let id = Uuid::new_v4();
        let conv_id = Uuid::new_v4();
        let event = ChatStreamEvent::Done {
            id,
            conversation_id: conv_id,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "done");
        assert_eq!(json["id"], id.to_string());
        assert_eq!(json["conversation_id"], conv_id.to_string());
    }
}
