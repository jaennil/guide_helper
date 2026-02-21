use anyhow::anyhow;
use serde::{Deserialize, Serialize};
use std::time::Duration;

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
    #[serde(default)]
    pub tool_calls: Vec<OpenAIToolCall>,
}

// ── Client ─────────────────────────────────────────────────────────────────────

pub struct OpenAIClient {
    http_client: reqwest::Client,
    base_url: String,
    model: String,
    api_key: String,
}

impl OpenAIClient {
    pub fn new(base_url: String, model: String, api_key: String) -> Self {
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

    pub fn model(&self) -> &str {
        &self.model
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub async fn chat(&self, request: OpenAIChatRequest) -> anyhow::Result<OpenAIChatResponse> {
        let url = format!("{}/chat/completions", self.base_url);
        tracing::debug!(%url, model = %request.model, messages_count = request.messages.len(), "sending chat request to OpenAI");

        let response = self
            .http_client
            .post(&url)
            .bearer_auth(&self.api_key)
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

    pub async fn health_check(&self) -> bool {
        let url = format!("{}/models/{}", self.base_url, self.model);
        match self
            .http_client
            .get(&url)
            .bearer_auth(&self.api_key)
            .send()
            .await
        {
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
