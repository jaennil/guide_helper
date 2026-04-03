use anyhow::Result;
use enum_map::Enum;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use unleash_api_client::client::{Client, Variant};

use super::ai_client::{AiChatClient, AiMessage, AiResponse, AiTool};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Enum)]
#[serde(rename_all = "kebab-case")]
pub enum UnleashFeatures {
    AiProvider,
}

pub type UnleashClient = Client<UnleashFeatures, reqwest::Client>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AiProvider {
    OpenAi,
    Ollama,
    Claude,
    Off,
}

impl AiProvider {
    fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "openai" => Some(Self::OpenAi),
            "ollama" => Some(Self::Ollama),
            "claude" | "anthropic" | "claude-code-api" => Some(Self::Claude),
            "off" | "disabled" | "none" => Some(Self::Off),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::OpenAi => "openai",
            Self::Ollama => "ollama",
            Self::Claude => "claude",
            Self::Off => "off",
        }
    }
}

/// Wraps multiple AI clients and selects one at runtime via Unleash feature flag.
/// Falls back to `default_provider` when Unleash is unavailable or flag is disabled.
pub struct DynamicAiClient {
    unleash: Option<Arc<UnleashClient>>,
    openai: Option<Arc<dyn AiChatClient>>,
    ollama: Option<Arc<dyn AiChatClient>>,
    claude: Option<Arc<dyn AiChatClient>>,
    default_provider: AiProvider,
}

unsafe impl Send for DynamicAiClient {}
unsafe impl Sync for DynamicAiClient {}

impl DynamicAiClient {
    pub fn new(
        unleash: Option<Arc<UnleashClient>>,
        openai: Option<Arc<dyn AiChatClient>>,
        ollama: Option<Arc<dyn AiChatClient>>,
        claude: Option<Arc<dyn AiChatClient>>,
        default_provider: String,
    ) -> Self {
        let default_provider = AiProvider::parse(&default_provider).unwrap_or_else(|| {
            tracing::warn!(
                provider = %default_provider,
                "unknown AI_PROVIDER, falling back to off"
            );
            AiProvider::Off
        });

        Self {
            unleash,
            openai,
            ollama,
            claude,
            default_provider,
        }
    }

    fn provider_from_variant(variant: &Variant) -> Option<AiProvider> {
        if !variant.enabled {
            return None;
        }

        let raw = variant
            .payload
            .get("provider")
            .or_else(|| variant.payload.get("value"))
            .map(String::as_str)
            .or_else(|| {
                if variant.name.trim().is_empty() || variant.name == "disabled" {
                    None
                } else {
                    Some(variant.name.as_str())
                }
            })?;

        let provider = AiProvider::parse(raw);
        if provider.is_none() {
            tracing::warn!(provider = %raw, "unknown Unleash AI provider variant");
        }
        provider
    }

    fn resolve_provider(&self) -> AiProvider {
        if let Some(unleash) = &self.unleash {
            let ctx = unleash_api_client::context::Context::default();
            let variant = unleash.get_variant(UnleashFeatures::AiProvider, &ctx);
            if let Some(provider) = Self::provider_from_variant(&variant) {
                tracing::debug!(provider = provider.as_str(), variant = %variant.name, "Unleash AI provider override active");
                return provider;
            }
        }
        self.default_provider
    }

    fn active_client_for(&self, provider: AiProvider) -> Option<&Arc<dyn AiChatClient>> {
        match provider {
            AiProvider::OpenAi => self.openai.as_ref(),
            AiProvider::Ollama => self.ollama.as_ref(),
            AiProvider::Claude => self.claude.as_ref(),
            AiProvider::Off => None,
        }
    }
}

#[async_trait::async_trait]
impl AiChatClient for DynamicAiClient {
    async fn chat(&self, messages: &[AiMessage], tools: &[AiTool]) -> Result<AiResponse> {
        let provider = self.resolve_provider();
        tracing::debug!(provider = provider.as_str(), "DynamicAiClient resolved provider");
        let client = self
            .active_client_for(provider)
            .ok_or_else(|| anyhow::anyhow!("no AI client configured for provider '{}'", provider.as_str()))?;
        client.chat(messages, tools).await
    }

    fn model(&self) -> &str {
        let provider = self.resolve_provider();
        tracing::debug!(provider = provider.as_str(), "DynamicAiClient resolved provider");
        self.active_client_for(provider)
            .map(|c| c.model())
            .unwrap_or_else(|| provider.as_str())
    }

    fn is_configured(&self) -> bool {
        let provider = self.resolve_provider();
        tracing::debug!(provider = provider.as_str(), "DynamicAiClient resolved provider");
        self.active_client_for(provider).is_some()
    }

    async fn health_check(&self) -> bool {
        let provider = self.resolve_provider();
        tracing::debug!(provider = provider.as_str(), "DynamicAiClient resolved provider");
        match self.active_client_for(provider) {
            Some(c) => c.health_check().await,
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct DummyClient {
        model: &'static str,
    }

    #[async_trait::async_trait]
    impl AiChatClient for DummyClient {
        async fn chat(&self, _messages: &[AiMessage], _tools: &[AiTool]) -> Result<AiResponse> {
            anyhow::bail!("not implemented")
        }

        fn model(&self) -> &str {
            self.model
        }

        fn is_configured(&self) -> bool {
            true
        }

        async fn health_check(&self) -> bool {
            true
        }
    }

    fn client(model: &'static str) -> Arc<dyn AiChatClient> {
        Arc::new(DummyClient { model })
    }

    #[test]
    fn test_ai_provider_parse_aliases() {
        assert_eq!(AiProvider::parse("openai"), Some(AiProvider::OpenAi));
        assert_eq!(AiProvider::parse("ollama"), Some(AiProvider::Ollama));
        assert_eq!(AiProvider::parse("claude"), Some(AiProvider::Claude));
        assert_eq!(AiProvider::parse("anthropic"), Some(AiProvider::Claude));
        assert_eq!(AiProvider::parse("claude-code-api"), Some(AiProvider::Claude));
        assert_eq!(AiProvider::parse("off"), Some(AiProvider::Off));
        assert_eq!(AiProvider::parse("none"), Some(AiProvider::Off));
    }

    #[test]
    fn test_provider_from_variant_uses_payload_value() {
        let mut payload = std::collections::HashMap::new();
        payload.insert("type".to_string(), "string".to_string());
        payload.insert("value".to_string(), "ollama".to_string());
        let variant = Variant {
            name: "ignored".to_string(),
            payload,
            enabled: true,
        };

        assert_eq!(
            DynamicAiClient::provider_from_variant(&variant),
            Some(AiProvider::Ollama)
        );
    }

    #[test]
    fn test_provider_from_variant_uses_name_when_payload_absent() {
        let variant = Variant {
            name: "claude".to_string(),
            payload: std::collections::HashMap::new(),
            enabled: true,
        };

        assert_eq!(
            DynamicAiClient::provider_from_variant(&variant),
            Some(AiProvider::Claude)
        );
    }

    #[test]
    fn test_provider_from_variant_disabled_returns_none() {
        let mut payload = std::collections::HashMap::new();
        payload.insert("value".to_string(), "openai".to_string());
        let variant = Variant {
            name: "openai".to_string(),
            payload,
            enabled: false,
        };

        assert_eq!(DynamicAiClient::provider_from_variant(&variant), None);
    }

    #[test]
    fn test_dynamic_ai_client_off_is_not_configured() {
        let client = DynamicAiClient::new(None, None, None, None, "off".to_string());

        assert!(!client.is_configured());
        assert_eq!(client.model(), "off");
    }

    #[test]
    fn test_dynamic_ai_client_selects_explicit_provider_without_fallback() {
        let dynamic_client = DynamicAiClient::new(
            None,
            Some(client("openai-model")),
            Some(client("ollama-model")),
            None,
            "ollama".to_string(),
        );

        assert!(dynamic_client.is_configured());
        assert_eq!(dynamic_client.model(), "ollama-model");

        let unavailable = DynamicAiClient::new(
            None,
            Some(client("openai-model")),
            None,
            None,
            "ollama".to_string(),
        );

        assert!(!unavailable.is_configured());
        assert_eq!(unavailable.model(), "ollama");
    }
}
