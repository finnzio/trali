use std::sync::Arc;

use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;

use crate::{
    commands::BackendState,
    error::{AppError, AppResult},
    prompts::{self, WorkMode},
    providers,
    settings::StyleConfig,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationVariant {
    pub id: String,
    pub style_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationRequest {
    pub request_id: String,
    pub mode: String,
    pub source_text: String,
    pub source_language: String,
    pub target_language: String,
    pub response_language: String,
    pub include_glossary: bool,
    pub variants: Vec<GenerationVariant>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GenerationEvent {
    Started {
        request_id: String,
        variant_id: String,
    },
    Delta {
        request_id: String,
        variant_id: String,
        text: String,
    },
    Completed {
        request_id: String,
        variant_id: String,
        speakable_text: Option<String>,
    },
    Error {
        request_id: String,
        variant_id: String,
        code: String,
        message: String,
    },
    AllCompleted {
        request_id: String,
    },
}

pub async fn generate(
    state: &BackendState,
    request: GenerationRequest,
    channel: Channel<GenerationEvent>,
) -> AppResult<()> {
    if request.variants.is_empty() {
        return Err(AppError::invalid(
            "at least one generation variant is required",
        ));
    }
    let mode = WorkMode::parse(&request.mode)?;
    let settings = state.settings.read().await.clone();
    let glossary = state.glossary.read().await.clone();
    let default_provider_id = settings
        .default_provider_id
        .clone()
        .ok_or_else(|| AppError::invalid("no default provider is configured"))?;
    let token = CancellationToken::new();
    {
        let mut cancellations = state.cancellations.lock().await;
        if let Some(previous) = cancellations.insert(request.request_id.clone(), token.clone()) {
            previous.cancel();
        }
    }
    let request = Arc::new(request);
    let results = stream::iter(request.variants.clone())
        .map(|variant| {
            let settings = settings.clone();
            let glossary = glossary.clone();
            let request = request.clone();
            let channel = channel.clone();
            let client = state.client.clone();
            let token = token.clone();
            let default_provider_id = default_provider_id.clone();
            async move {
                let _ = channel.send(GenerationEvent::Started {
                    request_id: request.request_id.clone(),
                    variant_id: variant.id.clone(),
                });
                let style: Option<StyleConfig> = variant.style_id.as_ref().and_then(|style_id| {
                    settings
                        .styles
                        .iter()
                        .find(|style| style.id == *style_id)
                        .cloned()
                });
                let provider_id = style
                    .as_ref()
                    .and_then(|item| item.provider_id.as_ref())
                    .unwrap_or(&default_provider_id);
                let Some(provider) = settings
                    .providers
                    .iter()
                    .find(|provider| provider.id == *provider_id)
                    .cloned()
                else {
                    let error = AppError::invalid("configured provider is unavailable");
                    let _ = channel.send(GenerationEvent::Error {
                        request_id: request.request_id.clone(),
                        variant_id: variant.id,
                        code: error.code,
                        message: error.message,
                    });
                    return;
                };
                let prompt = match prompts::prepare(
                    mode,
                    &request.source_text,
                    &request.source_language,
                    &request.target_language,
                    &request.response_language,
                    style.as_ref(),
                    request.include_glossary,
                    &glossary,
                ) {
                    Ok(prompt) => prompt,
                    Err(error) => {
                        let _ = channel.send(GenerationEvent::Error {
                            request_id: request.request_id.clone(),
                            variant_id: variant.id,
                            code: error.code,
                            message: error.message,
                        });
                        return;
                    }
                };
                let provider_id = provider.id.clone();
                let api_key = tokio::task::spawn_blocking(move || {
                    crate::secrets::get_api_key(&provider_id).ok()
                })
                .await
                .ok()
                .flatten();
                let result = providers::stream_completion(
                    &client,
                    &provider,
                    api_key.as_deref(),
                    &prompt,
                    token.clone(),
                    {
                        let channel = channel.clone();
                        let request_id = request.request_id.clone();
                        let variant_id = variant.id.clone();
                        move |text| {
                            let _ = channel.send(GenerationEvent::Delta {
                                request_id: request_id.clone(),
                                variant_id: variant_id.clone(),
                                text,
                            });
                        }
                    },
                )
                .await;
                match result {
                    Ok(output) => {
                        let _ = channel.send(GenerationEvent::Completed {
                            request_id: request.request_id.clone(),
                            variant_id: variant.id,
                            speakable_text: prompts::speakable_text(mode, style.is_some(), &output),
                        });
                    }
                    Err(error) if error.code == "cancelled" => {}
                    Err(error) => {
                        let _ = channel.send(GenerationEvent::Error {
                            request_id: request.request_id.clone(),
                            variant_id: variant.id,
                            code: error.code,
                            message: error.message,
                        });
                    }
                }
            }
        })
        .buffer_unordered(3)
        .collect::<Vec<_>>()
        .await;
    drop(results);
    state.cancellations.lock().await.remove(&request.request_id);
    let _ = channel.send(GenerationEvent::AllCompleted {
        request_id: request.request_id.clone(),
    });
    Ok(())
}

pub async fn cancel(state: &BackendState, request_id: &str) {
    if let Some(token) = state.cancellations.lock().await.remove(request_id) {
        token.cancel();
    }
}
