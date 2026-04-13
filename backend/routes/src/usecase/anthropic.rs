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

#[derive(Debug, Serialize)]
struct AnthropicVisionRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<AnthropicVisionMessage>,
}

#[derive(Debug, Serialize)]
struct AnthropicVisionMessage {
    role: String,
    content: Vec<AnthropicVisionBlock>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum AnthropicVisionBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image { source: AnthropicImageSource },
}

#[derive(Debug, Serialize)]
struct AnthropicImageSource {
    #[serde(rename = "type")]
    source_type: String,
    url: String,
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
                    let content = msg.content.clone().unwrap_or_default();
                    if content.trim().is_empty() {
                        continue;
                    }

                    if !system.is_empty() {
                        system.push_str("\n\n");
                    }
                    system.push_str(&content);
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

    pub async fn describe_route_from_images(
        &self,
        route_name: &str,
        photo_urls: &[String],
    ) -> Result<String> {
        if photo_urls.is_empty() {
            return Err(anyhow!("No photos provided for route description"));
        }

        let mut content = vec![AnthropicVisionBlock::Text {
            text: format!(
                "Ты — помощник туристического гида. По фотографиям маршрута «{}» напиши краткое описание маршрута на русском языке в 3-5 предложениях: что можно увидеть, какая атмосфера, кому подойдёт маршрут.",
                route_name
            ),
        }];

        for url in photo_urls {
            content.push(AnthropicVisionBlock::Image {
                source: AnthropicImageSource {
                    source_type: "url".to_string(),
                    url: url.clone(),
                },
            });
        }

        let request = AnthropicVisionRequest {
            model: self.model.clone(),
            max_tokens: 700,
            messages: vec![AnthropicVisionMessage {
                role: "user".to_string(),
                content,
            }],
        };

        tracing::debug!(
            model = %self.model,
            photo_count = photo_urls.len(),
            "sending vision request to Anthropic"
        );

        let response = self
            .http_client
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "Anthropic vision request failed");
                anyhow!("Anthropic vision request failed: {}", e)
            })?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| anyhow!("Failed to read Anthropic vision response: {}", e))?;

        if !status.is_success() {
            tracing::error!(%status, %body, "Anthropic vision returned error");
            return Err(anyhow!("Anthropic vision error ({}): {}", status, body));
        }

        let parsed: AnthropicResponse = serde_json::from_str(&body).map_err(|e| {
            tracing::error!(error = %e, %body, "failed to parse Anthropic vision response");
            anyhow!("Failed to parse Anthropic vision response: {}", e)
        })?;

        let description = parsed
            .content
            .into_iter()
            .filter_map(|block| match block {
                AnthropicBlock::Text { text } => Some(text),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string();

        if description.is_empty() {
            return Err(anyhow!("Empty response from Anthropic vision"));
        }

        Ok(description)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usecase::ai_client::{AiMessage, AiRole};

    #[test]
    fn test_build_messages_concatenates_multiple_system_messages() {
        let messages = vec![
            AiMessage {
                role: AiRole::System,
                content: Some("base prompt".to_string()),
                tool_calls: vec![],
                tool_call_id: None,
            },
            AiMessage {
                role: AiRole::System,
                content: Some("map context".to_string()),
                tool_calls: vec![],
                tool_call_id: None,
            },
            AiMessage {
                role: AiRole::User,
                content: Some("привет".to_string()),
                tool_calls: vec![],
                tool_call_id: None,
            },
        ];

        let (system, anthropic_messages) = AnthropicClient::build_messages(&messages);

        assert!(system.contains("base prompt"));
        assert!(system.contains("map context"));
        assert_eq!(anthropic_messages.len(), 1);
        assert_eq!(anthropic_messages[0].role, "user");
    }
}
