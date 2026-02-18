use anyhow::{anyhow, Error};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::chat_message::ChatMessage;
use crate::usecase::contracts::{ChatMessageRepository, RouteRepository};
use crate::usecase::ollama::{
    OllamaChatRequest, OllamaClient, OllamaMessage, OllamaTool, OllamaToolFunction,
};

const SYSTEM_PROMPT: &str = r#"You are a helpful route planning assistant for the Guide Helper application.
You help users find routes, plan trips, search the route catalog, and answer questions about places.
Always respond in the same language the user writes in.
You have access to tools for geocoding places and searching the route catalog.
When the user asks about a place or location, use the geocode tool.
When the user asks to find or search routes, use the search_routes tool.
When the user asks about a specific route by ID, use the get_route_details tool.
Be concise and helpful. When showing results, summarize them naturally."#;

const MAX_TOOL_ITERATIONS: usize = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ChatAction {
    #[serde(rename = "show_points")]
    ShowPoints { points: Vec<ChatPoint> },
    #[serde(rename = "show_routes")]
    ShowRoutes { routes: Vec<ChatRouteRef> },
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
    pub tags: Vec<String>,
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

pub struct ChatUseCase<CM, R>
where
    CM: ChatMessageRepository,
    R: RouteRepository,
{
    chat_repo: CM,
    route_repo: R,
    ollama: Option<OllamaClient>,
}

impl<CM, R> ChatUseCase<CM, R>
where
    CM: ChatMessageRepository,
    R: RouteRepository,
{
    pub fn new(chat_repo: CM, route_repo: R, ollama: Option<OllamaClient>) -> Self {
        Self {
            chat_repo,
            route_repo,
            ollama,
        }
    }

    pub fn is_available(&self) -> bool {
        self.ollama.is_some()
    }

    #[tracing::instrument(skip(self, text), fields(user_id = %user_id, conversation_id = %conversation_id))]
    pub async fn send_message(
        &self,
        user_id: Uuid,
        conversation_id: Uuid,
        text: String,
    ) -> Result<ChatResponse, Error> {
        let ollama = self
            .ollama
            .as_ref()
            .ok_or_else(|| anyhow!("AI assistant is not available"))?;

        tracing::info!(%user_id, %conversation_id, "processing chat message");

        // Save user message
        let user_msg = ChatMessage::new_user_message(user_id, conversation_id, text);
        self.chat_repo.create(&user_msg).await?;
        tracing::debug!(message_id = %user_msg.id, "user message saved");

        // Load conversation history
        let history = self
            .chat_repo
            .find_by_conversation(user_id, conversation_id, 20)
            .await?;
        tracing::debug!(history_count = history.len(), "loaded conversation history");

        // Build Ollama messages
        let mut messages = vec![OllamaMessage {
            role: "system".to_string(),
            content: SYSTEM_PROMPT.to_string(),
            tool_calls: None,
        }];
        for msg in &history {
            messages.push(OllamaMessage {
                role: msg.role.clone(),
                content: msg.content.clone(),
                tool_calls: None,
            });
        }

        let tools = build_tools();
        let mut actions: Vec<ChatAction> = Vec::new();

        // Function-calling loop
        for iteration in 0..MAX_TOOL_ITERATIONS {
            tracing::debug!(iteration, "sending request to Ollama");

            let request = OllamaChatRequest {
                model: ollama.model().to_string(),
                messages: messages.clone(),
                tools: Some(tools.clone()),
                stream: false,
            };

            let response = ollama.chat(request).await?;
            let resp_message = response.message;

            if let Some(ref tool_calls) = resp_message.tool_calls {
                tracing::info!(
                    iteration,
                    tool_count = tool_calls.len(),
                    "LLM requested tool calls"
                );

                // Add the assistant message with tool_calls to the conversation
                messages.push(resp_message.clone());

                for tool_call in tool_calls {
                    let tool_name = &tool_call.function.name;
                    let tool_args = &tool_call.function.arguments;
                    tracing::info!(%tool_name, ?tool_args, "executing tool call");

                    let (result_text, new_actions) =
                        self.execute_tool(tool_name, tool_args).await;

                    actions.extend(new_actions);

                    // Add tool result as a tool message
                    messages.push(OllamaMessage {
                        role: "tool".to_string(),
                        content: result_text,
                        tool_calls: None,
                    });
                }
            } else {
                // No tool calls — this is the final text response
                let assistant_text = resp_message.content.clone();
                tracing::info!(
                    iteration,
                    response_len = assistant_text.len(),
                    actions_count = actions.len(),
                    "LLM returned final text response"
                );

                let actions_json = if actions.is_empty() {
                    None
                } else {
                    Some(serde_json::to_value(&actions)?)
                };

                let assistant_msg = ChatMessage::new_assistant_message(
                    user_id,
                    conversation_id,
                    assistant_text.clone(),
                    actions_json,
                );
                self.chat_repo.create(&assistant_msg).await?;
                tracing::debug!(message_id = %assistant_msg.id, "assistant message saved");

                return Ok(ChatResponse {
                    id: assistant_msg.id,
                    message: assistant_text,
                    actions,
                    conversation_id,
                });
            }
        }

        tracing::warn!("tool-calling loop exhausted after {} iterations", MAX_TOOL_ITERATIONS);
        Err(anyhow!("AI assistant exceeded maximum tool call iterations"))
    }

    async fn execute_tool(
        &self,
        name: &str,
        args: &std::collections::HashMap<String, serde_json::Value>,
    ) -> (String, Vec<ChatAction>) {
        match name {
            "geocode" => self.tool_geocode(args).await,
            "search_routes" => self.tool_search_routes(args).await,
            "get_route_details" => self.tool_get_route_details(args).await,
            _ => {
                tracing::warn!(%name, "unknown tool called");
                (format!("Unknown tool: {}", name), vec![])
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

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap();

        let url = format!(
            "https://nominatim.openstreetmap.org/search?q={}&format=json&limit=1",
            urlencoding::encode(query)
        );

        match client
            .get(&url)
            .header("User-Agent", "GuideHelper/1.0")
            .send()
            .await
        {
            Ok(response) => {
                if let Ok(results) = response.json::<Vec<NominatimResult>>().await {
                    if let Some(result) = results.first() {
                        let lat: f64 = result.lat.parse().unwrap_or(0.0);
                        let lng: f64 = result.lon.parse().unwrap_or(0.0);
                        let display_name = &result.display_name;

                        tracing::info!(%query, lat, lng, %display_name, "geocode result found");

                        let action = ChatAction::ShowPoints {
                            points: vec![ChatPoint {
                                lat,
                                lng,
                                name: display_name.clone(),
                            }],
                        };

                        (
                            serde_json::json!({
                                "lat": lat,
                                "lng": lng,
                                "display_name": display_name
                            })
                            .to_string(),
                            vec![action],
                        )
                    } else {
                        tracing::info!(%query, "no geocode results found");
                        ("No results found for this query.".to_string(), vec![])
                    }
                } else {
                    tracing::error!(%query, "failed to parse geocode response");
                    ("Failed to parse geocoding response.".to_string(), vec![])
                }
            }
            Err(e) => {
                tracing::error!(%query, error = %e, "geocode request failed");
                (format!("Geocoding failed: {}", e), vec![])
            }
        }
    }

    async fn tool_search_routes(
        &self,
        args: &std::collections::HashMap<String, serde_json::Value>,
    ) -> (String, Vec<ChatAction>) {
        let search = args.get("query").and_then(|v| v.as_str()).map(String::from);
        let tag = args.get("tag").and_then(|v| v.as_str()).map(String::from);
        let sort = args
            .get("sort")
            .and_then(|v| v.as_str())
            .unwrap_or("newest");
        let limit = args
            .get("limit")
            .and_then(|v| v.as_i64())
            .unwrap_or(5)
            .min(10);

        tracing::info!(?search, ?tag, %sort, %limit, "executing search_routes tool");

        let order_clause = match sort {
            "oldest" => "r.created_at ASC",
            "popular" => "likes_count DESC, r.created_at DESC",
            "top_rated" => "avg_rating DESC, ratings_count DESC, r.created_at DESC",
            _ => "r.created_at DESC",
        };

        match self
            .route_repo
            .explore_shared(search, tag, order_clause, limit, 0)
            .await
        {
            Ok(routes) => {
                tracing::info!(count = routes.len(), "search_routes found results");

                let route_refs: Vec<ChatRouteRef> = routes
                    .iter()
                    .map(|r| ChatRouteRef {
                        id: r.id.to_string(),
                        name: r.name.clone(),
                        tags: r.tags.clone(),
                        avg_rating: r.avg_rating,
                        likes_count: r.likes_count,
                    })
                    .collect();

                let result_text = serde_json::to_string(&route_refs).unwrap_or_default();
                let actions = if route_refs.is_empty() {
                    vec![]
                } else {
                    vec![ChatAction::ShowRoutes {
                        routes: route_refs,
                    }]
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
                    "tags": route.tags,
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

    #[tracing::instrument(skip(self), fields(user_id = %user_id, conversation_id = %conversation_id))]
    pub async fn get_history(
        &self,
        user_id: Uuid,
        conversation_id: Uuid,
    ) -> Result<Vec<ChatMessage>, Error> {
        tracing::debug!("getting chat history");

        let messages = self
            .chat_repo
            .find_by_conversation(user_id, conversation_id, 100)
            .await?;

        tracing::debug!(count = messages.len(), "chat history retrieved");
        Ok(messages)
    }
}

#[derive(Debug, Deserialize)]
struct NominatimResult {
    lat: String,
    lon: String,
    display_name: String,
}

fn build_tools() -> Vec<OllamaTool> {
    vec![
        OllamaTool {
            tool_type: "function".to_string(),
            function: OllamaToolFunction {
                name: "geocode".to_string(),
                description: "Geocode a place name or address to get its latitude and longitude coordinates. Use this when the user asks about the location of a place.".to_string(),
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
        },
        OllamaTool {
            tool_type: "function".to_string(),
            function: OllamaToolFunction {
                name: "search_routes".to_string(),
                description: "Search the route catalog for shared routes. Can filter by text query, tag, and sort order.".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Text search query for route names"
                        },
                        "tag": {
                            "type": "string",
                            "description": "Filter by tag (e.g. hiking, cycling, historical, nature, urban)"
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
                    }
                }),
            },
        },
        OllamaTool {
            tool_type: "function".to_string(),
            function: OllamaToolFunction {
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
        },
    ]
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
