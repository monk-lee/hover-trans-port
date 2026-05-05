use std::collections::BTreeMap;

use serde_json::{json, Value};

use crate::cache::{resolve_translation_cache_path, SqliteTranslationCache};
use crate::cache_key::create_translation_cache_key;
use crate::messages::{
    BaseRequest, ProviderId, TranslateRequest, NATIVE_BRIDGE_VERSION, NATIVE_HOST_PROTOCOL_VERSION,
    NATIVE_HOST_VERSION,
};
use crate::process::ProviderError;
use crate::providers::{ProviderRegistry, ProviderTranslateRequest};

#[derive(Clone, Debug)]
pub struct BridgeDeps {
    env: BTreeMap<String, String>,
}

impl BridgeDeps {
    pub fn test() -> Self {
        Self::default()
    }

    pub fn with_env(env: BTreeMap<String, String>) -> Self {
        Self { env }
    }
}

impl Default for BridgeDeps {
    fn default() -> Self {
        Self {
            env: std::env::vars().collect(),
        }
    }
}

pub fn handle_request(value: Value, deps: BridgeDeps) -> Value {
    let base = match serde_json::from_value::<BaseRequest>(value.clone()) {
        Ok(base) => base,
        Err(_) => {
            return json!({
                "type": "ERROR",
                "ok": false,
                "error": "INVALID_MESSAGE",
                "message": "Native message must be a JSON object.",
                "retryable": false
            });
        }
    };

    let request_id = base.request_id.clone();

    match base.message_type.as_deref() {
        Some("PING") => pong(request_id),
        Some("HOST_INFO") => host_info(request_id),
        Some("PROVIDER_STATUS") => provider_status(request_id, deps),
        Some("TRANSLATE") => translate(value, request_id, deps),
        Some("CLEAR_TRANSLATION_CACHE") => cache_clear(request_id),
        Some("GET_DEBUG_LOG_INFO") => debug_log_info(request_id),
        Some("CLEAR_DEBUG_LOG") => debug_log_clear(request_id),
        Some("GET_DEBUG_LOG_CONTENT") => debug_log_content(request_id),
        Some("WRITE_DEBUG_LOG") => debug_log_write(request_id),
        _ => error_response(
            request_id,
            "UNSUPPORTED_MESSAGE",
            "Unsupported native message type.",
            false,
        ),
    }
}

fn pong(request_id: Option<String>) -> Value {
    json!({
        "type": "PONG",
        "requestId": request_id.unwrap_or_default(),
        "ok": true,
        "bridgeVersion": NATIVE_BRIDGE_VERSION
    })
}

fn host_info(request_id: Option<String>) -> Value {
    json!({
        "type": "HOST_INFO_RESULT",
        "requestId": request_id.unwrap_or_default(),
        "ok": true,
        "hostVersion": NATIVE_HOST_VERSION,
        "bridgeVersion": NATIVE_BRIDGE_VERSION,
        "protocolVersion": NATIVE_HOST_PROTOCOL_VERSION
    })
}

fn provider_status(request_id: Option<String>, deps: BridgeDeps) -> Value {
    let registry = ProviderRegistry::new(deps.env);
    json!({
        "type": "PROVIDER_STATUS_RESULT",
        "requestId": request_id.unwrap_or_default(),
        "ok": true,
        "providers": registry.status_entries()
    })
}

fn translate(value: Value, request_id: Option<String>, deps: BridgeDeps) -> Value {
    let request = serde_json::from_value::<TranslateRequest>(value);

    match request {
        Ok(request)
            if !request.text.trim().is_empty() && !request.target_lang.trim().is_empty() =>
        {
            translate_valid(request, deps)
        }
        _ => json!({
            "type": "TRANSLATE_RESULT",
            "requestId": request_id.unwrap_or_default(),
            "ok": false,
            "error": "INVALID_MESSAGE",
            "message": "TRANSLATE message is missing required fields.",
            "retryable": false,
            "elapsedMs": 0
        }),
    }
}

fn translate_valid(request: TranslateRequest, deps: BridgeDeps) -> Value {
    let registry = ProviderRegistry::new(deps.env);
    let timeout_ms = request.timeout_ms.unwrap_or(30_000).max(1);
    let source_lang = request.source_lang.unwrap_or_else(|| "auto".to_string());
    let provider_selection = request.provider.as_deref();

    if request.cache_enabled.unwrap_or(true) {
        let cache =
            SqliteTranslationCache::new(resolve_translation_cache_path(), current_time_millis);
        let key = create_translation_cache_key(
            ProviderId::Codex,
            request.model.as_deref().unwrap_or("default"),
            &request.target_lang,
            &request.text,
        );

        if let Ok(Some(hit)) = cache.lookup(&key) {
            return json!({
                "type": "TRANSLATE_RESULT",
                "requestId": request.request_id,
                "ok": true,
                "provider": "codex",
                "translatedText": hit.translated_text,
                "cached": true,
                "elapsedMs": 0
            });
        }

        let provider_result = registry.translate(
            provider_selection,
            ProviderTranslateRequest {
                text: request.text,
                model: request.model,
                source_lang,
                target_lang: request.target_lang.clone(),
                timeout_ms,
            },
        );

        return match provider_result {
            Ok((provider, result)) => {
                let _ = cache.write(&key, &result.translated_text);
                json!({
                    "type": "TRANSLATE_RESULT",
                    "requestId": request.request_id,
                    "ok": true,
                    "provider": provider.as_str(),
                    "translatedText": result.translated_text,
                    "cached": false,
                    "elapsedMs": result.elapsed_ms
                })
            }
            Err(error) => provider_error_response(request.request_id, error),
        };
    }

    match registry.translate(
        provider_selection,
        ProviderTranslateRequest {
            text: request.text,
            model: request.model,
            source_lang,
            target_lang: request.target_lang,
            timeout_ms,
        },
    ) {
        Ok((provider, result)) => json!({
            "type": "TRANSLATE_RESULT",
            "requestId": request.request_id,
            "ok": true,
            "provider": provider.as_str(),
            "translatedText": result.translated_text,
            "cached": false,
            "elapsedMs": result.elapsed_ms
        }),
        Err(error) => provider_error_response(request.request_id, error),
    }
}

fn provider_error_response(request_id: String, error: ProviderError) -> Value {
    let elapsed_ms = match &error {
        ProviderError::ExitNonzero { elapsed_ms, .. } | ProviderError::Timeout { elapsed_ms } => {
            *elapsed_ms
        }
        _ => 0,
    };

    json!({
        "type": "TRANSLATE_RESULT",
        "requestId": request_id,
        "ok": false,
        "error": error.code(),
        "message": error.to_string(),
        "retryable": error.retryable(),
        "elapsedMs": elapsed_ms
    })
}

fn current_time_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().try_into().unwrap_or(i64::MAX))
        .unwrap_or(0)
}

fn cache_clear(request_id: Option<String>) -> Value {
    json!({
        "type": "CACHE_CLEAR_RESULT",
        "requestId": request_id.unwrap_or_default(),
        "ok": false,
        "error": "CACHE_ERROR",
        "message": "Cache is not initialized.",
        "retryable": true
    })
}

fn debug_log_info(request_id: Option<String>) -> Value {
    json!({
        "type": "DEBUG_LOG_INFO_RESULT",
        "requestId": request_id.unwrap_or_default(),
        "ok": true,
        "logPath": "",
        "exists": false,
        "sizeBytes": 0
    })
}

fn debug_log_clear(request_id: Option<String>) -> Value {
    json!({
        "type": "DEBUG_LOG_CLEAR_RESULT",
        "requestId": request_id.unwrap_or_default(),
        "ok": true,
        "logPath": "",
        "exists": false,
        "sizeBytes": 0
    })
}

fn debug_log_content(request_id: Option<String>) -> Value {
    json!({
        "type": "DEBUG_LOG_CONTENT_RESULT",
        "requestId": request_id.unwrap_or_default(),
        "ok": true,
        "logPath": "",
        "exists": false,
        "sizeBytes": 0,
        "content": "",
        "truncated": false
    })
}

fn debug_log_write(request_id: Option<String>) -> Value {
    json!({
        "type": "DEBUG_LOG_WRITE_RESULT",
        "requestId": request_id.unwrap_or_default(),
        "ok": true,
        "written": false
    })
}

fn error_response(
    request_id: Option<String>,
    error: &str,
    message: &str,
    retryable: bool,
) -> Value {
    json!({
        "type": "ERROR",
        "requestId": request_id,
        "ok": false,
        "error": error,
        "message": message,
        "retryable": retryable
    })
}
