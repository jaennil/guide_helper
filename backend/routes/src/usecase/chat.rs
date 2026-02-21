use futures::Stream;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::chat_message::{ChatMessage, ConversationSummary};
use crate::usecase::contracts::{ChatMessageRepository, RouteRepository};
use crate::usecase::error::UsecaseError;
use crate::usecase::openai::{
    OpenAIFunction, OpenAIFunctionCallPolicy, OpenAIFunctionCallRef, OpenAIChatRequest, OpenAIClient, OpenAIMessage,
};

const SYSTEM_PROMPT: &str = r#"You are a helpful route planning assistant for the Guide Helper application.
You help users find routes, plan trips, search the route catalog, and answer questions about places.
Always respond in the same language the user writes in.
You have access to tools for geocoding places and searching the route catalog.
When the user asks about a place or location, use the geocode tool.
When the user asks to find or search routes, use the search_routes tool.
When the user asks about a specific route by ID, use the get_route_details tool.
Be concise and helpful. When showing results, summarize them naturally."#;

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
    assistant: Option<OpenAIClient>,
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
        assistant: Option<OpenAIClient>,
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
        self.assistant.is_some()
    }

    pub fn model_name(&self) -> &str {
        self.assistant
            .as_ref()
            .map(|a| a.model())
            .unwrap_or("none")
    }

    pub async fn check_health(&self) -> bool {
        match self.assistant.as_ref() {
            Some(client) => client.health_check().await,
            None => {
                tracing::debug!("health check: OpenAI assistant not configured");
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
        let assistant = self
            .assistant
            .as_ref()
            .ok_or_else(|| UsecaseError::Unavailable("AI assistant is not available".to_string()))?;

        tracing::info!(%user_id, %conversation_id, "processing chat message");

        let user_msg = ChatMessage::new_user_message(user_id, conversation_id, text);
        self.chat_repo.create(&user_msg).await?;
        tracing::debug!(message_id = %user_msg.id, "user message saved");

        let history = self
            .chat_repo
            .find_by_conversation(user_id, conversation_id, 20)
            .await?;
        tracing::debug!(history_count = history.len(), "loaded conversation history");

        let mut messages = vec![OpenAIMessage {
            role: "system".to_string(),
            content: Some(SYSTEM_PROMPT.to_string()),
            name: None,
            function_call: None,
        }];
        for msg in &history {
            messages.push(OpenAIMessage {
                role: msg.role.clone(),
                content: Some(msg.content.clone()),
                name: None,
                function_call: None,
            });
        }

        let functions = build_functions();
        let mut actions: Vec<ChatAction> = Vec::new();

        for iteration in 0..self.max_tool_iterations {
            tracing::debug!(iteration, "sending request to OpenAI");

            let request = OpenAIChatRequest {
                model: assistant.model().to_string(),
                messages: messages.clone(),
                functions: Some(functions.clone()),
                function_call: Some(OpenAIFunctionCallPolicy::Auto),
            };

            let response = assistant.chat(request).await?;
            let choice = response
                .choices
                .get(0)
                .ok_or_else(||
                    UsecaseError::Internal("OpenAI returned no choices".to_string())
                )?;
            let resp_message = choice.message.clone();

            if let Some(function_call) = resp_message.function_call.clone() {
                tracing::info!(
                    iteration,
                    tool_name = %function_call.name,
                    "LLM requested function call"
                );

                messages.push(OpenAIMessage {
                    role: resp_message.role.clone(),
                    content: resp_message.content.clone(),
                    name: resp_message.name.clone(),
                    function_call: Some(OpenAIFunctionCallRef {
                        name: function_call.name.clone(),
                        arguments: function_call.arguments.clone(),
                    }),
                });

                let tool_args = parse_function_arguments(&function_call.arguments);
                let (result_text, new_actions) =
                    self.execute_tool(&function_call.name, &tool_args).await;

                actions.extend(new_actions);

                messages.push(OpenAIMessage {
                    role: "function".to_string(),
                    content: Some(result_text.clone()),
                    name: Some(function_call.name.clone()),
                    function_call: None,
                });
            } else {
                let assistant_text = resp_message.content.clone().unwrap_or_default();
                tracing::info!(
                    iteration,
                    response_len = assistant_text.len(),
                    actions_count = actions.len(),
                    "OpenAI returned final text response"
                );

                let actions_json = if actions.is_empty() {
                    None
                } else {
                    Some(serde_json::to_value(&actions).map_err(|e| {
                        UsecaseError::Internal(
                            format!("failed to serialize actions: {}", e)
                        )
                    })?)
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

        tracing::warn!(
            "tool-calling loop exhausted after {} iterations",
            self.max_tool_iterations
        );
        Err(UsecaseError::Internal(
            "AI assistant exceeded maximum tool call iterations".to_string(),
        ))
    }

    #[tracing::instrument(skip(self, text), fields(user_id = %user_id, conversation_id = %conversation_id))]
    pub async fn send_message_stream(
        &self,
        user_id: Uuid,
        conversation_id: Uuid,
        text: String,
    ) -> Result<(ChatResponse, std::pin::Pin<Box<dyn Stream<Item = Result<ChatStreamEvent, UsecaseError>> + Send>>), UsecaseError> {
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

        let url = format!(
            "{}/search?q={}&format=json&limit=1",
            self.nominatim_url,
            urlencoding::encode(query)
        );

        match self
            .http_client
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
        let category_id = args.get("category_id").and_then(|v| v.as_str()).and_then(|s| Uuid::parse_str(s).ok());
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
            .explore_shared(search, category_id, order_clause, limit, 0)
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

        self.chat_repo
            .delete_message(user_id, message_id)
            .await?;

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

fn build_functions() -> Vec<OpenAIFunction> {
    vec![
        OpenAIFunction {
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
        OpenAIFunction {
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
        OpenAIFunction {
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
    ]
}

fn parse_function_arguments(
    input: &str,
) -> std::collections::HashMap<String, serde_json::Value> {
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
    use crate::usecase::contracts::{MockChatMessageRepository, MockRouteRepository};
    use crate::usecase::openai::OpenAIClient;
    use std::collections::HashMap;

    fn make_usecase(
        chat_repo: MockChatMessageRepository,
        route_repo: MockRouteRepository,
        with_assistant: bool,
    ) -> ChatUseCase<MockChatMessageRepository, MockRouteRepository> {
        let assistant = if with_assistant {
            Some(OpenAIClient::new(
                "https://api.openai.com/v1".to_string(),
                "test-model".to_string(),
                "test-key".to_string(),
            ))
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
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("not available"));
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
        }];

        mock_route
            .expect_explore_shared()
            .times(1)
            .return_once(move |_, _, _, _, _| Ok(rows));

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
            .return_once(|_, _, _, _, _| Ok(vec![]));

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
            .withf(|_, _, order, _, _| order == "likes_count DESC, r.created_at DESC")
            .times(1)
            .return_once(|_, _, _, _, _| Ok(vec![]));

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
            .return_once(|_, _, _, _, _| Err(RepositoryError::NotFound));

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
    fn test_build_tools_returns_three_tools() {
        let functions = build_functions();
        assert_eq!(functions.len(), 3);

        let names: Vec<&str> = functions.iter().map(|f| f.name.as_str()).collect();
        assert!(names.contains(&"geocode"));
        assert!(names.contains(&"search_routes"));
        assert!(names.contains(&"get_route_details"));
    }

    #[test]
    fn test_build_tools_all_function_type() {
        let functions = build_functions();
        for function in &functions {
            assert!(!function.name.is_empty());
        }
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
            actions: vec![ChatAction::ShowPoints {
                points: vec![],
            }],
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
            .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(
                serde_json::json!([{
                    "lat": "55.7558",
                    "lon": "37.6173",
                    "display_name": "Moscow, Russia"
                }]),
            ))
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
            .respond_with(
                wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!([])),
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
