use std::sync::Arc;

use crate::config::AppConfig;
use crate::repository::postgres::{PostgresChatMessageRepository, PostgresRouteRepository};
use crate::usecase::ai_client::AiChatClient;
use crate::usecase::anthropic::AnthropicClient;
use crate::usecase::chat::ChatUseCase;
use crate::usecase::dynamic_ai_client::{DynamicAiClient, UnleashPoller};
use crate::usecase::openai::OpenAIClient;
use crate::usecase::routes::RoutesUseCase;

fn non_empty(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn non_empty_str(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn openai_compatible_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/v1")
    }
}

fn is_official_openai_base_url(base_url: &str) -> bool {
    let trimmed = base_url.trim().trim_end_matches('/');
    trimmed.eq_ignore_ascii_case("https://api.openai.com/v1")
        || trimmed.eq_ignore_ascii_case("https://api.openai.com")
}

fn build_openai_compatible_client(
    provider: &str,
    base_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
) -> Option<Arc<dyn AiChatClient>> {
    let base_url = openai_compatible_base_url(&base_url?);
    let model = model?;
    let api_key = non_empty(api_key);

    if is_official_openai_base_url(&base_url) && api_key.is_none() {
        tracing::warn!(provider, %base_url, "provider disabled because API key is missing");
        return None;
    }

    tracing::info!(provider, %base_url, %model, has_api_key = api_key.is_some(), "OpenAI-compatible client configured");
    Some(Arc::new(OpenAIClient::new(base_url, model, api_key)) as Arc<dyn AiChatClient>)
}

pub fn build_routes_usecase(
    config: &AppConfig,
    route_repository: PostgresRouteRepository,
) -> RoutesUseCase<PostgresRouteRepository> {
    let nominatim_client =
        crate::usecase::nominatim::NominatimClient::new(config.nominatim_url.clone());
    let ollama_client = non_empty(config.ollama_base_url.clone()).map(|base_url| {
        tracing::info!(%base_url, model = %config.ollama_vision_model, "Ollama vision client configured");
        OpenAIClient::new(
            openai_compatible_base_url(&base_url),
            config.ollama_vision_model.clone(),
            None,
        )
    });
    let anthropic_vision_client = non_empty(config.anthropic_api_key.clone()).map(|key| {
        tracing::info!(model = %config.anthropic_model, "Anthropic vision client configured");
        AnthropicClient::new(config.anthropic_model.clone(), key)
    });

    let usecase = RoutesUseCase::new(route_repository).with_nominatim(nominatim_client);
    let usecase = if let Some(client) = anthropic_vision_client {
        usecase.with_anthropic(client)
    } else {
        usecase
    };

    if let Some(client) = ollama_client {
        usecase.with_ollama(client, config.ollama_vision_model.clone())
    } else {
        usecase
    }
}

fn build_assistant_client(config: &AppConfig) -> Option<Arc<dyn AiChatClient>> {
    let openai_client = build_openai_compatible_client(
        "openai",
        non_empty_str(&config.openai_base_url),
        non_empty_str(&config.openai_model),
        config.openai_api_key.clone(),
    );

    let ollama_chat_client = non_empty(config.ollama_chat_base_url.clone()).map(|base_url| {
        let base_url = openai_compatible_base_url(&base_url);
        tracing::info!(provider = "ollama", %base_url, model = %config.ollama_chat_model, "Ollama chat client configured");
        Arc::new(OpenAIClient::new(
            base_url,
            config.ollama_chat_model.clone(),
            None,
        )) as Arc<dyn AiChatClient>
    });

    let anthropic_client: Option<Arc<dyn AiChatClient>> =
        non_empty(config.anthropic_api_key.clone()).map(|key| {
            tracing::info!(model = %config.anthropic_model, "Anthropic client configured");
            Arc::new(AnthropicClient::new(config.anthropic_model.clone(), key))
                as Arc<dyn AiChatClient>
        });

    let claude_proxy_client = build_openai_compatible_client(
        "claude",
        non_empty(config.claude_base_url.clone()),
        non_empty_str(&config.claude_model),
        config.claude_api_key.clone(),
    );

    let claude_client = claude_proxy_client.or(anthropic_client.clone());
    let unleash_client = match (&config.unleash_url, &config.unleash_api_token) {
        (Some(url), Some(token)) => {
            tracing::info!(%url, "Starting Unleash poller for ai-provider feature flag");
            Some(Arc::new(UnleashPoller::new(
                url.clone(),
                token.clone(),
                "ai-provider".to_string(),
            )))
        }
        _ => {
            tracing::info!(default_provider = %config.ai_provider, "Unleash not configured, using static AI_PROVIDER");
            None
        }
    };

    Some(Arc::new(DynamicAiClient::new(
        unleash_client,
        openai_client,
        ollama_chat_client,
        claude_client,
        config.ai_provider.clone(),
    )))
}

pub fn build_chat_usecase(
    config: &AppConfig,
    chat_message_repository: PostgresChatMessageRepository,
    route_repository: PostgresRouteRepository,
) -> ChatUseCase<PostgresChatMessageRepository, PostgresRouteRepository> {
    let assistant_client = build_assistant_client(config);
    ChatUseCase::new(
        chat_message_repository,
        route_repository,
        assistant_client,
        config.nominatim_url.clone(),
        config.chat_max_tool_iterations,
        config.chat_max_message_length,
    )
}
