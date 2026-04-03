use anyhow::Result;
use serde::{Deserialize, Serialize};

// ── Shared types used by ChatUseCase ──────────────────────────────────────────

/// Uniform tool definition passed to any AI provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiTool {
    pub name: String,
    pub description: String,
    /// JSON Schema for the tool's input parameters.
    pub parameters: serde_json::Value,
}

/// Single tool call requested by the model.
#[derive(Debug, Clone)]
pub struct AiToolCall {
    pub id: String,
    pub name: String,
    /// Raw JSON arguments string.
    pub arguments: String,
}

/// One message in the conversation.
#[derive(Debug, Clone)]
pub struct AiMessage {
    pub role: AiRole,
    pub content: Option<String>,
    /// Assistant message with pending tool calls.
    pub tool_calls: Vec<AiToolCall>,
    /// Tool result — links back to the tool_call by id.
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AiRole {
    System,
    User,
    Assistant,
    Tool,
}

impl AiRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            AiRole::System => "system",
            AiRole::User => "user",
            AiRole::Assistant => "assistant",
            AiRole::Tool => "tool",
        }
    }
}

/// Response from one call to the AI.
#[derive(Debug)]
pub struct AiResponse {
    pub content: Option<String>,
    pub tool_calls: Vec<AiToolCall>,
    pub stop: bool, // true when model is done (no more tool calls)
}

/// Abstraction over OpenAI-compatible and Anthropic chat APIs.
#[async_trait::async_trait]
pub trait AiChatClient: Send + Sync {
    async fn chat(&self, messages: &[AiMessage], tools: &[AiTool]) -> Result<AiResponse>;
    fn model(&self) -> &str;
    fn is_configured(&self) -> bool;
    async fn health_check(&self) -> bool;
}
