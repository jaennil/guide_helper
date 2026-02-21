use anyhow::anyhow;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
pub struct OpenAIMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OpenAIFunction {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OpenAIFunctionCallPolicy {
    Auto,
}

#[derive(Debug, Serialize)]
pub struct OpenAIChatRequest {
    pub model: String,
    pub messages: Vec<OpenAIMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub functions: Option<Vec<OpenAIFunction>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function_call: Option<OpenAIFunctionCallPolicy>,
}

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
    pub name: Option<String>,
    #[serde(rename = "function_call")]
    pub function_call: Option<OpenAIFunctionCall>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct OpenAIFunctionCall {
    pub name: String,
    pub arguments: String,
}

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
