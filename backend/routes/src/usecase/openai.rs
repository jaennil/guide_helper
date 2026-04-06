use anyhow::anyhow;
use serde::{Deserialize, Deserializer, Serialize};
use std::time::Duration;

use crate::usecase::ai_client::{AiChatClient, AiMessage, AiResponse, AiTool, AiToolCall};

/// Deserialize `null` as `Default::default()` (empty Vec).
fn deserialize_null_as_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::deserialize(deserializer)?.unwrap_or_default())
}

// ── Request types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct OpenAITool {
    #[serde(rename = "type")]
    pub tool_type: String, // always "function"
    pub function: OpenAIFunction,
}

#[derive(Debug, Clone, Serialize)]
pub struct OpenAIFunction {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct OpenAIMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// Present when role == "tool" — links back to the tool_call that triggered this result
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// Present when role == "assistant" and the model wants to call tools
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<OpenAIToolCall>>,
}

/// A tool-call record stored inside an assistant message (outbound, serialised)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenAIToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String, // always "function"
    pub function: OpenAIToolCallFunction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenAIToolCallFunction {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Serialize)]
pub struct OpenAIChatRequest {
    pub model: String,
    pub messages: Vec<OpenAIMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<OpenAITool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<String>, // "auto" | "none" | "required"
}

// ── Response types ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct OpenAIChatResponse {
    pub choices: Vec<OpenAIChoice>,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIChoice {
    pub message: OpenAIResponseMessage,
}

#[derive(Debug, Deserialize, Clone)]
pub struct OpenAIResponseMessage {
    pub role: String,
    pub content: Option<String>,
    /// Non-empty when the model requested one or more tool calls
    #[serde(default, deserialize_with = "deserialize_null_as_default")]
    pub tool_calls: Vec<OpenAIToolCall>,
}

// ── Vision request types ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct VisionContentPart {
    #[serde(rename = "type")]
    pub part_type: String, // "text" or "image_url"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_url: Option<VisionImageUrl>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VisionImageUrl {
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct VisionChatRequest {
    pub model: String,
    pub messages: Vec<VisionMessage>,
}

#[derive(Debug, Serialize)]
pub struct VisionMessage {
    pub role: String,
    pub content: Vec<VisionContentPart>,
}

// ── Client ─────────────────────────────────────────────────────────────────────

pub struct OpenAIClient {
    http_client: reqwest::Client,
    base_url: String,
    model: String,
    api_key: Option<String>,
}

impl OpenAIClient {
    pub fn new(base_url: String, model: String, api_key: Option<String>) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .expect("failed to create reqwest client");

        tracing::info!(%base_url, %model, "OpenAI client created");

        Self {
            http_client,
            base_url,
            model,
            api_key,
        }
    }

    fn authorize(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match self.api_key.as_ref().filter(|key| !key.trim().is_empty()) {
            Some(api_key) => builder.bearer_auth(api_key),
            None => builder,
        }
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub async fn raw_chat(&self, request: OpenAIChatRequest) -> anyhow::Result<OpenAIChatResponse> {
        let url = format!("{}/chat/completions", self.base_url);
        tracing::debug!(%url, model = %request.model, messages_count = request.messages.len(), "sending chat request to OpenAI");

        let response = self
            .authorize(self.http_client.post(&url))
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "failed to send request to OpenAI");
                anyhow!("OpenAI request failed: {}", e)
            })?;

        let status = response.status();
        let body = response.text().await.map_err(|e| {
            tracing::error!(error = %e, "failed to read OpenAI response");
            anyhow!("Failed to read OpenAI response: {}", e)
        })?;

        if !status.is_success() {
            tracing::error!(%status, %body, "OpenAI returned error");
            return Err(anyhow!("OpenAI error ({}): {}", status, body));
        }

        serde_json::from_str::<OpenAIChatResponse>(&body).map_err(|e| {
            tracing::error!(error = %e, %body, "failed to parse OpenAI response");
            anyhow!("Failed to parse OpenAI response: {}", e)
        })
    }

    pub async fn vision_chat(
        &self,
        request: VisionChatRequest,
    ) -> anyhow::Result<OpenAIChatResponse> {
        let url = format!("{}/chat/completions", self.base_url);
        tracing::debug!(%url, model = %request.model, "sending vision chat request");

        let response = self
            .authorize(self.http_client.post(&url))
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "failed to send vision request");
                anyhow!("Vision request failed: {}", e)
            })?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| anyhow!("Failed to read vision response: {}", e))?;

        if !status.is_success() {
            tracing::error!(%status, %body, "vision API returned error");
            return Err(anyhow!("Vision API error ({}): {}", status, body));
        }

        serde_json::from_str::<OpenAIChatResponse>(&body).map_err(|e| {
            tracing::error!(error = %e, %body, "failed to parse vision response");
            anyhow!("Failed to parse vision response: {}", e)
        })
    }

    pub async fn health_check(&self) -> bool {
        let url = format!("{}/models", self.base_url);
        match self.authorize(self.http_client.get(&url)).send().await {
            Ok(resp) if resp.status().is_success() => {
                tracing::debug!(status = %resp.status(), "OpenAI health check ok");
                true
            }
            Ok(resp) => {
                tracing::warn!(status = %resp.status(), "OpenAI health check failed");
                false
            }
            Err(e) => {
                tracing::warn!(error = %e, "OpenAI health check error");
                false
            }
        }
    }
}

// ── AiChatClient impl for OpenAIClient ────────────────────────────────────────

#[async_trait::async_trait]
impl AiChatClient for OpenAIClient {
    async fn chat(&self, messages: &[AiMessage], tools: &[AiTool]) -> anyhow::Result<AiResponse> {
        let oai_tools: Vec<OpenAITool> = tools
            .iter()
            .map(|t| OpenAITool {
                tool_type: "function".to_string(),
                function: OpenAIFunction {
                    name: t.name.clone(),
                    description: t.description.clone(),
                    parameters: t.parameters.clone(),
                },
            })
            .collect();

        let oai_messages: Vec<OpenAIMessage> = messages
            .iter()
            .map(|m| OpenAIMessage {
                role: m.role.as_str().to_string(),
                content: m.content.clone(),
                tool_call_id: m.tool_call_id.clone(),
                tool_calls: if m.tool_calls.is_empty() {
                    None
                } else {
                    Some(
                        m.tool_calls
                            .iter()
                            .map(|tc| OpenAIToolCall {
                                id: tc.id.clone(),
                                call_type: "function".to_string(),
                                function: OpenAIToolCallFunction {
                                    name: tc.name.clone(),
                                    arguments: tc.arguments.clone(),
                                },
                            })
                            .collect(),
                    )
                },
            })
            .collect();

        let request = OpenAIChatRequest {
            model: self.model.clone(),
            messages: oai_messages,
            tools: if oai_tools.is_empty() {
                None
            } else {
                Some(oai_tools)
            },
            tool_choice: Some("auto".to_string()),
        };

        let resp = self.raw_chat(request).await?;
        let choice = resp
            .choices
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("OpenAI returned no choices"))?;

        let msg = choice.message;
        let stop = msg.tool_calls.is_empty();
        let tool_calls: Vec<AiToolCall> = msg
            .tool_calls
            .into_iter()
            .map(|tc| AiToolCall {
                id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments,
            })
            .collect();

        Ok(AiResponse {
            content: msg.content,
            tool_calls,
            stop,
        })
    }

    fn model(&self) -> &str {
        self.model()
    }

    fn is_configured(&self) -> bool {
        true
    }

    async fn health_check(&self) -> bool {
        self.health_check().await
    }
}
