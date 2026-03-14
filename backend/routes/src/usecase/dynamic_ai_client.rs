use anyhow::Result;
use enum_map::Enum;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use unleash_api_client::client::Client;

use super::ai_client::{AiChatClient, AiMessage, AiResponse, AiTool};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Enum)]
#[serde(rename_all = "kebab-case")]
pub enum UnleashFeatures {
    AiProvider,
}

pub type UnleashClient = Client<UnleashFeatures, reqwest::Client>;

/// Wraps multiple AI clients and selects one at runtime via Unleash feature flag.
/// Falls back to `default_provider` when Unleash is unavailable or flag is disabled.
pub struct DynamicAiClient {
    unleash: Option<Arc<UnleashClient>>,
    openai: Option<Arc<dyn AiChatClient>>,
    anthropic: Option<Arc<dyn AiChatClient>>,
    claude_code_api: Option<Arc<dyn AiChatClient>>,
    default_provider: String,
}

unsafe impl Send for DynamicAiClient {}
unsafe impl Sync for DynamicAiClient {}

impl DynamicAiClient {
    pub fn new(
        unleash: Option<Arc<UnleashClient>>,
        openai: Option<Arc<dyn AiChatClient>>,
        anthropic: Option<Arc<dyn AiChatClient>>,
        claude_code_api: Option<Arc<dyn AiChatClient>>,
        default_provider: String,
    ) -> Self {
        Self {
            unleash,
            openai,
            anthropic,
            claude_code_api,
            default_provider,
        }
    }

    fn resolve_provider(&self) -> &str {
        if let Some(unleash) = &self.unleash {
            let ctx = unleash_api_client::context::Context::default();
            let variant = unleash.get_variant(UnleashFeatures::AiProvider, &ctx);
            if variant.enabled {
                for (key, value) in &variant.payload {
                    tracing::debug!(provider = %value, key = %key, "Unleash ai-provider variant active");
                    return Box::leak(value.clone().into_boxed_str());
                }
            }
        }
        &self.default_provider
    }

    fn active_client(&self) -> Option<&Arc<dyn AiChatClient>> {
        let provider = self.resolve_provider();
        tracing::debug!(provider, "DynamicAiClient resolved provider");
        match provider {
            "anthropic" => self.anthropic.as_ref().or(self.openai.as_ref()),
            "claude-code-api" => self.claude_code_api.as_ref().or(self.openai.as_ref()),
            _ => self.openai.as_ref(),
        }
    }
}

#[async_trait::async_trait]
impl AiChatClient for DynamicAiClient {
    async fn chat(&self, messages: &[AiMessage], tools: &[AiTool]) -> Result<AiResponse> {
        let client = self
            .active_client()
            .ok_or_else(|| anyhow::anyhow!("no AI client configured for provider '{}'", self.resolve_provider()))?;
        client.chat(messages, tools).await
    }

    fn model(&self) -> &str {
        self.active_client()
            .map(|c| c.model())
            .unwrap_or("unknown")
    }

    async fn health_check(&self) -> bool {
        match self.active_client() {
            Some(c) => c.health_check().await,
            None => false,
        }
    }
}
