use anyhow::Result;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::ai_client::{AiChatClient, AiMessage, AiResponse, AiTool};

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

/// Simple Unleash poller that fetches feature flags via HTTP and extracts variant name.
/// Replaces the broken `unleash-api-client` crate.
pub struct UnleashPoller {
    current_variant: Arc<RwLock<Option<String>>>,
}

impl UnleashPoller {
    pub fn new(url: String, token: String, feature_name: String) -> Self {
        let current_variant = Arc::new(RwLock::new(None));
        let cv = current_variant.clone();

        tokio::spawn(async move {
            let client = reqwest::Client::new();
            let features_url = format!("{}/client/features", url.trim_end_matches('/'));
            tracing::info!(%features_url, "Unleash poller started");

            loop {
                match client
                    .get(&features_url)
                    .header("Authorization", &token)
                    .send()
                    .await
                {
                    Ok(resp) => {
                        if let Ok(body) = resp.json::<serde_json::Value>().await {
                            let variant_name = body["features"]
                                .as_array()
                                .and_then(|features| {
                                    features.iter().find(|f| f["name"] == feature_name)
                                })
                                .and_then(|feature| {
                                    if feature["enabled"].as_bool() != Some(true) {
                                        return None;
                                    }
                                    // Strategy-level variants (Unleash 5+)
                                    feature["strategies"]
                                        .as_array()
                                        .and_then(|strategies| strategies.first())
                                        .and_then(|s| s["variants"].as_array())
                                        .and_then(|variants| variants.first())
                                        .and_then(|v| v["name"].as_str())
                                        .map(String::from)
                                        // Fallback to feature-level variants
                                        .or_else(|| {
                                            feature["variants"]
                                                .as_array()
                                                .and_then(|v| v.first())
                                                .and_then(|v| v["name"].as_str())
                                                .map(String::from)
                                        })
                                });

                            let mut lock = cv.write().await;
                            if *lock != variant_name {
                                tracing::info!(
                                    old = ?*lock,
                                    new = ?variant_name,
                                    "Unleash AI provider variant changed"
                                );
                            }
                            *lock = variant_name;
                        }
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "Unleash poll failed");
                    }
                }

                tokio::time::sleep(std::time::Duration::from_secs(15)).await;
            }
        });

        Self { current_variant }
    }

    async fn get_variant(&self) -> Option<String> {
        self.current_variant.read().await.clone()
    }
}

/// Wraps multiple AI clients and selects one at runtime via Unleash feature flag.
/// Falls back to `default_provider` when Unleash is unavailable or flag is disabled.
pub struct DynamicAiClient {
    unleash: Option<Arc<UnleashPoller>>,
    openai: Option<Arc<dyn AiChatClient>>,
    ollama: Option<Arc<dyn AiChatClient>>,
    claude: Option<Arc<dyn AiChatClient>>,
    default_provider: AiProvider,
}

unsafe impl Send for DynamicAiClient {}
unsafe impl Sync for DynamicAiClient {}

impl DynamicAiClient {
    pub fn new(
        unleash: Option<Arc<UnleashPoller>>,
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

    async fn resolve_provider(&self) -> AiProvider {
        if let Some(unleash) = &self.unleash {
            if let Some(variant_name) = unleash.get_variant().await {
                if let Some(provider) = AiProvider::parse(&variant_name) {
                    tracing::debug!(provider = provider.as_str(), variant = %variant_name, "Unleash AI provider override active");
                    return provider;
                }
                tracing::warn!(variant = %variant_name, "unknown Unleash AI provider variant");
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
        let provider = self.resolve_provider().await;
        tracing::debug!(provider = provider.as_str(), "DynamicAiClient resolved provider");
        let client = self
            .active_client_for(provider)
            .ok_or_else(|| anyhow::anyhow!("no AI client configured for provider '{}'", provider.as_str()))?;
        client.chat(messages, tools).await
    }

    fn model(&self) -> &str {
        // Sync method — can't await, use default
        self.active_client_for(self.default_provider)
            .map(|c| c.model())
            .unwrap_or(self.default_provider.as_str())
    }

    fn is_configured(&self) -> bool {
        // Check if at least one client exists
        self.openai.is_some() || self.ollama.is_some() || self.claude.is_some()
    }

    async fn health_check(&self) -> bool {
        let provider = self.resolve_provider().await;
        match self.active_client_for(provider) {
            Some(c) => c.health_check().await,
            None => false,
        }
    }
}
