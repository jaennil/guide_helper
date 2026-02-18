use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<OllamaToolCall>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaToolCall {
    pub function: OllamaFunctionCall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaFunctionCall {
    pub name: String,
    pub arguments: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OllamaTool {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: OllamaToolFunction,
}

#[derive(Debug, Clone, Serialize)]
pub struct OllamaToolFunction {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct OllamaChatRequest {
    pub model: String,
    pub messages: Vec<OllamaMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<OllamaTool>>,
    pub stream: bool,
}

#[derive(Debug, Deserialize)]
pub struct OllamaChatResponse {
    pub message: OllamaMessage,
    #[allow(dead_code)]
    pub done: bool,
}

pub struct OllamaClient {
    http_client: reqwest::Client,
    base_url: String,
    model: String,
}

impl OllamaClient {
    pub fn new(base_url: String, model: String) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("failed to create reqwest client");

        tracing::info!(%base_url, %model, "OllamaClient created");

        Self {
            http_client,
            base_url,
            model,
        }
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub async fn chat(&self, request: OllamaChatRequest) -> anyhow::Result<OllamaChatResponse> {
        let url = format!("{}/api/chat", self.base_url);
        tracing::debug!(%url, model = %request.model, messages_count = request.messages.len(), "sending chat request to Ollama");

        let response = self
            .http_client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "failed to send request to Ollama");
                anyhow::anyhow!("Ollama request failed: {}", e)
            })?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            tracing::error!(%status, %body, "Ollama returned error");
            return Err(anyhow::anyhow!("Ollama error ({}): {}", status, body));
        }

        let chat_response: OllamaChatResponse = response.json().await.map_err(|e| {
            tracing::error!(error = %e, "failed to parse Ollama response");
            anyhow::anyhow!("Failed to parse Ollama response: {}", e)
        })?;

        tracing::debug!(
            role = %chat_response.message.role,
            has_tool_calls = chat_response.message.tool_calls.is_some(),
            "received Ollama response"
        );

        Ok(chat_response)
    }

    pub async fn chat_stream(
        &self,
        request: OllamaChatRequest,
    ) -> anyhow::Result<reqwest::Response> {
        let url = format!("{}/api/chat", self.base_url);
        tracing::debug!(%url, model = %request.model, "sending streaming chat request to Ollama");

        let response = self
            .http_client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "failed to send streaming request to Ollama");
                anyhow::anyhow!("Ollama streaming request failed: {}", e)
            })?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            tracing::error!(%status, %body, "Ollama streaming returned error");
            return Err(anyhow::anyhow!("Ollama error ({}): {}", status, body));
        }

        tracing::debug!("Ollama streaming response started");
        Ok(response)
    }
}
