/// Anthropic Messages API client with tool use support.
use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::usecase::ai_client::{AiChatClient, AiMessage, AiResponse, AiRole, AiTool, AiToolCall};

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

// ── Request types ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    system: String,
    messages: Vec<AnthropicMessage>,
    tools: Vec<AnthropicTool>,
}

#[derive(Debug, Serialize)]
struct AnthropicMessage {
    role: String, // "user" | "assistant"
    content: AnthropicContent,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum AnthropicContent {
    Text(String),
    Blocks(Vec<AnthropicBlock>),
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
enum AnthropicBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: String,
    },
}

#[derive(Debug, Serialize)]
struct AnthropicTool {
    name: String,
    description: String,
    input_schema: serde_json::Value,
}

// ── Response types ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicBlock>,
    stop_reason: Option<String>,
}

// ── Client ─────────────────────────────────────────────────────────────────────

pub struct AnthropicClient {
    http_client: reqwest::Client,
    model: String,
    api_key: String,
}

impl AnthropicClient {
    pub fn new(model: String, api_key: String) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .expect("failed to create reqwest client for Anthropic");

        tracing::info!(%model, "AnthropicClient created");

        Self {
            http_client,
            model,
            api_key,
        }
    }

    /// Convert our `AiMessage` slice into Anthropic's format.
    /// System messages are extracted separately; the rest become user/assistant turns.
    fn build_messages(messages: &[AiMessage]) -> (String, Vec<AnthropicMessage>) {
        let mut system = String::new();
        let mut out: Vec<AnthropicMessage> = Vec::new();

        for msg in messages {
            match msg.role {
                AiRole::System => {
                    system = msg.content.clone().unwrap_or_default();
                }
                AiRole::User => {
                    out.push(AnthropicMessage {
                        role: "user".to_string(),
                        content: AnthropicContent::Text(msg.content.clone().unwrap_or_default()),
                    });
                }
                AiRole::Assistant => {
                    if msg.tool_calls.is_empty() {
                        out.push(AnthropicMessage {
                            role: "assistant".to_string(),
                            content: AnthropicContent::Text(
                                msg.content.clone().unwrap_or_default(),
                            ),
                        });
                    } else {
                        // Assistant message with tool_use blocks
                        let mut blocks: Vec<AnthropicBlock> = Vec::new();
                        if let Some(text) = &msg.content {
                            if !text.is_empty() {
                                blocks.push(AnthropicBlock::Text { text: text.clone() });
                            }
                        }
                        for tc in &msg.tool_calls {
                            let input: serde_json::Value = serde_json::from_str(&tc.arguments)
                                .unwrap_or(serde_json::Value::Object(Default::default()));
                            blocks.push(AnthropicBlock::ToolUse {
                                id: tc.id.clone(),
                                name: tc.name.clone(),
                                input,
                            });
                        }
                        out.push(AnthropicMessage {
                            role: "assistant".to_string(),
                            content: AnthropicContent::Blocks(blocks),
                        });
                    }
                }
                AiRole::Tool => {
                    // Tool results must be grouped as a user message with tool_result blocks.
                    // Find or create the latest user message for grouping.
                    let block = AnthropicBlock::ToolResult {
                        tool_use_id: msg.tool_call_id.clone().unwrap_or_default(),
                        content: msg.content.clone().unwrap_or_default(),
                    };
                    if let Some(last) = out.last_mut() {
                        if last.role == "user" {
                            if let AnthropicContent::Blocks(blocks) = &mut last.content {
                                blocks.push(block);
                                continue;
                            }
                        }
                    }
                    // Start a new user message with this tool_result
                    out.push(AnthropicMessage {
                        role: "user".to_string(),
                        content: AnthropicContent::Blocks(vec![block]),
                    });
                }
            }
        }

        (system, out)
    }
}

#[async_trait::async_trait]
impl AiChatClient for AnthropicClient {
    async fn chat(&self, messages: &[AiMessage], tools: &[AiTool]) -> Result<AiResponse> {
        let (system, anthropic_messages) = Self::build_messages(messages);

        let anthropic_tools: Vec<AnthropicTool> = tools
            .iter()
            .map(|t| AnthropicTool {
                name: t.name.clone(),
                description: t.description.clone(),
                input_schema: t.parameters.clone(),
            })
            .collect();

        let request = AnthropicRequest {
            model: self.model.clone(),
            max_tokens: 4096,
            system,
            messages: anthropic_messages,
            tools: anthropic_tools,
        };

        tracing::debug!(model = %self.model, messages_count = messages.len(), "sending request to Anthropic");

        let response = self
            .http_client
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "Anthropic request failed");
                anyhow!("Anthropic request failed: {}", e)
            })?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| anyhow!("Failed to read Anthropic response: {}", e))?;

        if !status.is_success() {
            tracing::error!(%status, %body, "Anthropic returned error");
            return Err(anyhow!("Anthropic error ({}): {}", status, body));
        }

        let parsed: AnthropicResponse = serde_json::from_str(&body).map_err(|e| {
            tracing::error!(error = %e, %body, "failed to parse Anthropic response");
            anyhow!("Failed to parse Anthropic response: {}", e)
        })?;

        let stop = parsed.stop_reason.as_deref() != Some("tool_use");

        let mut text_parts: Vec<String> = Vec::new();
        let mut tool_calls: Vec<AiToolCall> = Vec::new();

        for block in &parsed.content {
            match block {
                AnthropicBlock::Text { text } => text_parts.push(text.clone()),
                AnthropicBlock::ToolUse { id, name, input } => {
                    tool_calls.push(AiToolCall {
                        id: id.clone(),
                        name: name.clone(),
                        arguments: input.to_string(),
                    });
                }
                _ => {}
            }
        }

        let content = if text_parts.is_empty() {
            None
        } else {
            Some(text_parts.join("\n"))
        };

        Ok(AiResponse {
            content,
            tool_calls,
            stop,
        })
    }

    fn model(&self) -> &str {
        &self.model
    }

    fn is_configured(&self) -> bool {
        true
    }

    async fn health_check(&self) -> bool {
        // Simple check: send a minimal request
        let request = serde_json::json!({
            "model": self.model,
            "max_tokens": 10,
            "messages": [{"role": "user", "content": "hi"}]
        });
        match self
            .http_client
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => true,
            Ok(r) => {
                tracing::warn!(status = %r.status(), "Anthropic health check failed");
                false
            }
            Err(e) => {
                tracing::warn!(error = %e, "Anthropic health check error");
                false
            }
        }
    }
}
