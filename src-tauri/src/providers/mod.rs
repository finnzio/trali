use futures_util::StreamExt;
use reqwest::{
    header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE},
    Client, Response,
};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use crate::{
    error::{AppError, AppResult},
    prompts::PreparedPrompt,
    settings::{ProviderConfig, ProviderType},
};

fn api_url(endpoint: &str, path: &str) -> AppResult<String> {
    let endpoint = endpoint.trim().trim_end_matches('/');
    if !(endpoint.starts_with("https://") || endpoint.starts_with("http://")) {
        return Err(AppError::invalid(
            "provider endpoint must use http or https",
        ));
    }
    if endpoint.ends_with(path) {
        Ok(endpoint.to_owned())
    } else {
        Ok(format!("{endpoint}/{path}"))
    }
}

fn apply_auth(
    request: reqwest::RequestBuilder,
    provider_type: &ProviderType,
    api_key: Option<&str>,
) -> reqwest::RequestBuilder {
    match (provider_type, api_key.filter(|value| !value.is_empty())) {
        (ProviderType::OpenaiCompatible, Some(key)) => {
            request.header(AUTHORIZATION, format!("Bearer {key}"))
        }
        (ProviderType::AnthropicCompatible, Some(key)) => request
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01"),
        (ProviderType::AnthropicCompatible, None) => {
            request.header("anthropic-version", "2023-06-01")
        }
        _ => request,
    }
}

async fn checked_response(response: Response) -> AppResult<Response> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let body = response.text().await.unwrap_or_default();
    let message = body.chars().take(500).collect::<String>();
    Err(AppError::provider(if message.is_empty() {
        format!("provider returned HTTP {status}")
    } else {
        format!("provider returned HTTP {status}: {message}")
    }))
}

pub async fn fetch_models(
    client: &Client,
    provider: &ProviderConfig,
    api_key: Option<&str>,
) -> AppResult<Vec<String>> {
    let url = api_url(&provider.endpoint, "models")?;
    let request = apply_auth(
        client.get(url).header(ACCEPT, "application/json"),
        &provider.provider_type,
        api_key,
    );
    let payload: Value = checked_response(
        request
            .send()
            .await
            .map_err(|error| AppError::provider(format!("connection failed: {error}")))?,
    )
    .await?
    .json()
    .await
    .map_err(|error| AppError::provider(format!("invalid models response: {error}")))?;
    let mut models = payload
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("id").and_then(Value::as_str))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    models.sort();
    models.dedup();
    Ok(models)
}

pub async fn test_connection(
    client: &Client,
    provider: &ProviderConfig,
    api_key: Option<&str>,
) -> AppResult<()> {
    fetch_models(client, provider, api_key).await.map(|_| ())
}

pub async fn stream_completion<F>(
    client: &Client,
    provider: &ProviderConfig,
    api_key: Option<&str>,
    prompt: &PreparedPrompt,
    cancel: CancellationToken,
    mut on_delta: F,
) -> AppResult<String>
where
    F: FnMut(String) + Send,
{
    let (path, payload) = match provider.provider_type {
        ProviderType::OpenaiCompatible => (
            "chat/completions",
            json!({
                "model": provider.model,
                "stream": true,
                "messages": [
                    { "role": "system", "content": prompt.system },
                    { "role": "user", "content": prompt.user }
                ]
            }),
        ),
        ProviderType::AnthropicCompatible => (
            "messages",
            json!({
                "model": provider.model,
                "max_tokens": 4096,
                "stream": true,
                "system": prompt.system,
                "messages": [
                    { "role": "user", "content": prompt.user }
                ]
            }),
        ),
    };
    if provider.model.trim().is_empty() {
        return Err(AppError::invalid("provider model is not configured"));
    }
    let url = api_url(&provider.endpoint, path)?;
    let request = apply_auth(
        client
            .post(url)
            .header(ACCEPT, "text/event-stream")
            .header(CONTENT_TYPE, "application/json")
            .json(&payload),
        &provider.provider_type,
        api_key,
    );
    let response = checked_response(
        request
            .send()
            .await
            .map_err(|error| AppError::provider(format!("request failed: {error}")))?,
    )
    .await?;
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned();

    if !content_type.contains("text/event-stream") {
        let payload: Value = response
            .json()
            .await
            .map_err(|error| AppError::provider(format!("invalid response: {error}")))?;
        let text = final_text(&provider.provider_type, &payload)
            .ok_or_else(|| AppError::provider("provider response did not contain text"))?;
        on_delta(text.clone());
        return Ok(text);
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut output = String::new();
    loop {
        let next = tokio::select! {
            _ = cancel.cancelled() => return Err(AppError::new("cancelled", "generation cancelled")),
            value = stream.next() => value,
        };
        let Some(chunk) = next else { break };
        let chunk = chunk.map_err(|error| AppError::provider(format!("stream failed: {error}")))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(index) = buffer.find('\n') {
            let line = buffer[..index].trim_end_matches('\r').to_owned();
            buffer.drain(..=index);
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            if let Some(delta) = stream_delta(&provider.provider_type, &value) {
                output.push_str(delta);
                on_delta(delta.to_owned());
            }
            if let Some(message) = stream_error(&value) {
                return Err(AppError::provider(message));
            }
        }
    }
    if output.is_empty() {
        Err(AppError::provider("provider returned an empty response"))
    } else {
        Ok(output)
    }
}

fn stream_delta<'a>(provider_type: &ProviderType, payload: &'a Value) -> Option<&'a str> {
    match provider_type {
        ProviderType::OpenaiCompatible => payload
            .pointer("/choices/0/delta/content")
            .and_then(Value::as_str),
        ProviderType::AnthropicCompatible => payload.pointer("/delta/text").and_then(Value::as_str),
    }
}

fn final_text<'a>(provider_type: &ProviderType, payload: &'a Value) -> Option<String> {
    match provider_type {
        ProviderType::OpenaiCompatible => payload
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .map(str::to_owned),
        ProviderType::AnthropicCompatible => {
            let text = payload
                .get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|item| item.get("text").and_then(Value::as_str))
                .collect::<String>();
            (!text.is_empty()).then_some(text)
        }
    }
}

fn stream_error(payload: &Value) -> Option<String> {
    (payload.get("type").and_then(Value::as_str) == Some("error")).then(|| {
        payload
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("provider stream error")
            .to_owned()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_only_http_api_urls() {
        assert_eq!(
            api_url("https://example.com/v1/", "models").unwrap(),
            "https://example.com/v1/models"
        );
        assert!(api_url("file:///secret", "models").is_err());
    }

    #[test]
    fn extracts_both_provider_stream_shapes() {
        let openai = json!({"choices": [{"delta": {"content": "Hello"}}]});
        let anthropic = json!({"delta": {"text": "World"}});
        assert_eq!(
            stream_delta(&ProviderType::OpenaiCompatible, &openai),
            Some("Hello")
        );
        assert_eq!(
            stream_delta(&ProviderType::AnthropicCompatible, &anthropic),
            Some("World")
        );
    }
}
