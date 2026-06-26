use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::Instant;

use serde_json::{json, Value};

use crate::cache::{resolve_translation_cache_path_from_env, SqliteTranslationCache};
use crate::cache_key::create_translation_cache_key;
use crate::debug_log::{
    clear_debug_log, debug_log_info as read_debug_log_info, log_debug_event, read_debug_log_tail,
    write_debug_log_event,
};
use crate::messages::{
    BaseRequest, DebugLogContentRequest, DebugLogWriteRequest, NativeHostUpdateRequest, ProviderId,
    ProviderModelsRequest, ProviderStatusRequest, SubtitleCacheRequest, SubtitleCacheWriteRequest,
    TranslateRequest, TranslateSubtitlesRequest, NATIVE_BRIDGE_VERSION,
    NATIVE_HOST_PROTOCOL_VERSION, NATIVE_HOST_VERSION,
};
use crate::process::ProviderError;
use crate::providers::{
    resolve_provider_id, ProviderPromptRequest, ProviderRegistry, ProviderTranslateRequest,
};
use crate::subtitle_cache::{SqliteSubtitleTranslationCache, SubtitleCacheKey};
use crate::subtitles::{
    audit_subtitle_translation_quality, build_subtitle_repair_prompt,
    build_subtitle_translation_prompt, create_subtitle_quality_repair_chunk,
    parse_subtitle_translation_output_allowing_quality_issues, plan_subtitle_chunks,
    summarize_subtitle_quality_issues, validate_subtitle_translation_output,
    validate_translated_subtitle_cues, SubtitleChunk, SubtitleQualityIssue, TranslatedSubtitleCue,
};
use crate::update::{check_update, run_update, UpdateFailure};

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
        Some("PROVIDER_STATUS") => provider_status(value, request_id, deps),
        Some("PROVIDER_MODELS") => provider_models(value, request_id, deps),
        Some("TRANSLATE") => translate(value, request_id, deps),
        Some("GET_SUBTITLE_TRANSLATION_CACHE") => subtitle_cache_lookup(value, request_id, deps),
        Some("WRITE_SUBTITLE_TRANSLATION_CACHE") => subtitle_cache_write(value, request_id, deps),
        Some("TRANSLATE_SUBTITLES") => translate_subtitles(value, request_id, deps),
        Some("CLEAR_TRANSLATION_CACHE") => cache_clear(request_id, deps),
        Some("GET_DEBUG_LOG_INFO") => debug_log_info(request_id, deps),
        Some("CLEAR_DEBUG_LOG") => debug_log_clear(request_id, deps),
        Some("GET_DEBUG_LOG_CONTENT") => debug_log_content(value, request_id, deps),
        Some("WRITE_DEBUG_LOG") => debug_log_write(value, request_id, deps),
        Some("NATIVE_HOST_UPDATE_STATUS") => native_host_update_status(request_id, deps),
        Some("NATIVE_HOST_UPDATE") => native_host_update(value, request_id, deps),
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

fn provider_status(value: Value, request_id: Option<String>, deps: BridgeDeps) -> Value {
    let request = serde_json::from_value::<ProviderStatusRequest>(value).ok();
    let provider = request
        .as_ref()
        .and_then(|request| request.provider.as_deref());
    let registry = ProviderRegistry::new(deps.env);
    json!({
        "type": "PROVIDER_STATUS_RESULT",
        "requestId": request_id.unwrap_or_default(),
        "ok": true,
        "providers": registry.status_entries(provider)
    })
}

fn provider_models(value: Value, request_id: Option<String>, deps: BridgeDeps) -> Value {
    let request = serde_json::from_value::<ProviderModelsRequest>(value);
    let Ok(request) = request else {
        return json!({
            "type": "PROVIDER_MODELS_RESULT",
            "requestId": request_id.unwrap_or_default(),
            "ok": false,
            "provider": "codex",
            "error": "INVALID_MESSAGE",
            "message": "PROVIDER_MODELS message is missing required fields.",
            "retryable": false
        });
    };
    let registry = ProviderRegistry::new(deps.env);
    let provider_id = registry.provider_id_for_selection(request.provider.as_deref());
    let catalog = registry.model_catalog(provider_id);

    json!({
        "type": "PROVIDER_MODELS_RESULT",
        "requestId": request.request_id,
        "ok": true,
        "catalog": catalog
    })
}

fn native_host_update_status(request_id: Option<String>, deps: BridgeDeps) -> Value {
    match check_update(&deps.env, NATIVE_HOST_VERSION) {
        Ok(status) => json!({
            "type": "NATIVE_HOST_UPDATE_STATUS_RESULT",
            "requestId": request_id.unwrap_or_default(),
            "ok": true,
            "installedVersion": status.installed_version,
            "latestVersion": status.latest_version,
            "latestTag": status.latest_tag,
            "updateAvailable": status.update_available,
            "releaseUrl": status.release_url
        }),
        Err(error) => update_error_response(
            "NATIVE_HOST_UPDATE_STATUS_RESULT",
            request_id.unwrap_or_default(),
            error,
        ),
    }
}

fn native_host_update(value: Value, request_id: Option<String>, deps: BridgeDeps) -> Value {
    let request = serde_json::from_value::<NativeHostUpdateRequest>(value);
    let Ok(request) = request else {
        return json!({
            "type": "NATIVE_HOST_UPDATE_RESULT",
            "requestId": request_id.unwrap_or_default(),
            "ok": false,
            "error": "INVALID_MESSAGE",
            "message": "NATIVE_HOST_UPDATE message is missing required fields.",
            "retryable": false
        });
    };

    match run_update(&deps.env, &request.target_tag, &request.target_version) {
        Ok(result) => json!({
            "type": "NATIVE_HOST_UPDATE_RESULT",
            "requestId": request.request_id,
            "ok": true,
            "previousVersion": result.previous_version,
            "installedVersion": result.installed_version,
            "installedPath": result.installed_path
        }),
        Err(error) => update_error_response("NATIVE_HOST_UPDATE_RESULT", request.request_id, error),
    }
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
    let registry = ProviderRegistry::new(deps.env.clone());
    let timeout_ms = request.timeout_ms.unwrap_or(30_000).max(1);
    let source_lang = request.source_lang.unwrap_or_else(|| "auto".to_string());
    let provider_selection = request.provider.clone();
    let effective_provider = resolve_provider_id(provider_selection.as_deref());
    let debug_logging = request.debug_logging.unwrap_or(false);
    let cache_enabled = request.cache_enabled.unwrap_or(true);
    let request_id = request.request_id.clone();
    let target_lang = request.target_lang.clone();
    let model = request.model.clone().unwrap_or_default();
    let text_length = request.text.chars().count();

    log_debug_event(
        &deps.env,
        debug_logging,
        "translation.start",
        json!({
            "requestId": request_id,
            "provider": effective_provider.as_str(),
            "model": model,
            "targetLang": target_lang,
            "timeoutMs": timeout_ms,
            "cacheEnabled": cache_enabled,
            "textLength": text_length
        }),
    );

    if cache_enabled {
        let cache = SqliteTranslationCache::new(
            resolve_translation_cache_path_from_env(&deps.env),
            current_time_millis,
        );
        let key = create_translation_cache_key(
            effective_provider,
            request.model.as_deref().unwrap_or("default"),
            &request.target_lang,
            &request.text,
        );

        if let Ok(Some(hit)) = cache.lookup(&key) {
            log_debug_event(
                &deps.env,
                debug_logging,
                "cache.hit",
                json!({"requestId": request.request_id, "elapsedMs": 0}),
            );
            log_debug_event(
                &deps.env,
                debug_logging,
                "translation.success",
                json!({"requestId": request.request_id, "cached": true, "elapsedMs": 0}),
            );
            return json!({
                "type": "TRANSLATE_RESULT",
                "requestId": request.request_id,
                "ok": true,
                "provider": effective_provider.as_str(),
                "translatedText": hit.translated_text,
                "cached": true,
                "elapsedMs": 0
            });
        }
        log_debug_event(
            &deps.env,
            debug_logging,
            "cache.miss",
            json!({"requestId": request.request_id}),
        );

        log_debug_event(
            &deps.env,
            debug_logging,
            "provider.start",
            json!({"requestId": request.request_id, "provider": effective_provider.as_str()}),
        );
        let provider_result = registry.translate(
            provider_selection.as_deref(),
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
                match cache.write(&key, &result.translated_text) {
                    Ok(()) => log_debug_event(
                        &deps.env,
                        debug_logging,
                        "cache.write",
                        json!({"requestId": request.request_id}),
                    ),
                    Err(error) => log_debug_event(
                        &deps.env,
                        debug_logging,
                        "cache.write_failed",
                        json!({
                            "requestId": request.request_id,
                            "message": error.to_string()
                        }),
                    ),
                }
                log_debug_event(
                    &deps.env,
                    debug_logging,
                    "translation.success",
                    json!({
                        "requestId": request.request_id,
                        "cached": false,
                        "elapsedMs": result.elapsed_ms
                    }),
                );
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
            Err(error) => {
                log_provider_error(&deps.env, debug_logging, &request.request_id, &error);
                provider_error_response(request.request_id, error)
            }
        };
    }

    log_debug_event(
        &deps.env,
        debug_logging,
        "cache.disabled",
        json!({"requestId": request.request_id}),
    );
    log_debug_event(
        &deps.env,
        debug_logging,
        "provider.start",
        json!({"requestId": request.request_id, "provider": effective_provider.as_str()}),
    );
    match registry.translate(
        provider_selection.as_deref(),
        ProviderTranslateRequest {
            text: request.text,
            model: request.model,
            source_lang,
            target_lang: request.target_lang,
            timeout_ms,
        },
    ) {
        Ok((provider, result)) => {
            log_debug_event(
                &deps.env,
                debug_logging,
                "translation.success",
                json!({
                    "requestId": request.request_id,
                    "cached": false,
                    "elapsedMs": result.elapsed_ms
                }),
            );
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
        Err(error) => {
            log_provider_error(&deps.env, debug_logging, &request.request_id, &error);
            provider_error_response(request.request_id, error)
        }
    }
}

fn subtitle_cache_lookup(value: Value, request_id: Option<String>, deps: BridgeDeps) -> Value {
    let request = serde_json::from_value::<SubtitleCacheRequest>(value);

    match request {
        Ok(request)
            if !request.target_lang.trim().is_empty()
                && !request.video_id.trim().is_empty()
                && !request.source_track_identity.trim().is_empty()
                && !request.source_timeline_hash.trim().is_empty() =>
        {
            let provider = resolve_provider_id(request.provider.as_deref());
            let cache = SqliteSubtitleTranslationCache::new(
                resolve_translation_cache_path_from_env(&deps.env),
                current_time_millis,
            );
            let key = subtitle_cache_key(
                provider,
                request.model.as_deref().unwrap_or("default"),
                &request.target_lang,
                &request.video_id,
                &request.source_track_identity,
                &request.source_timeline_hash,
                request.prompt_version,
            );

            match cache.lookup(&key) {
                Ok(Some(hit)) => json!({
                    "type": "SUBTITLE_CACHE_RESULT",
                    "requestId": request.request_id,
                    "ok": true,
                    "cached": true,
                    "cues": hit.cues
                }),
                Ok(None) => json!({
                    "type": "SUBTITLE_CACHE_RESULT",
                    "requestId": request.request_id,
                    "ok": true,
                    "cached": false
                }),
                Err(error) => subtitle_cache_error_response(
                    request.request_id,
                    "CACHE_ERROR",
                    error.to_string(),
                    true,
                ),
            }
        }
        _ => subtitle_cache_error_response(
            request_id.unwrap_or_default(),
            "INVALID_MESSAGE",
            "GET_SUBTITLE_TRANSLATION_CACHE message is missing required fields.",
            false,
        ),
    }
}

fn subtitle_cache_write(value: Value, request_id: Option<String>, deps: BridgeDeps) -> Value {
    let request = serde_json::from_value::<SubtitleCacheWriteRequest>(value);

    match request {
        Ok(request)
            if !request.target_lang.trim().is_empty()
                && !request.video_id.trim().is_empty()
                && !request.source_track_identity.trim().is_empty()
                && !request.source_timeline_hash.trim().is_empty()
                && !request.source_cues.is_empty()
                && !request.translated_cues.is_empty() =>
        {
            let provider = resolve_provider_id(request.provider.as_deref());
            let cache = SqliteSubtitleTranslationCache::new(
                resolve_translation_cache_path_from_env(&deps.env),
                current_time_millis,
            );
            let key = subtitle_cache_key(
                provider,
                request.model.as_deref().unwrap_or("default"),
                &request.target_lang,
                &request.video_id,
                &request.source_track_identity,
                &request.source_timeline_hash,
                request.prompt_version,
            );

            let translated_cues = match validate_translated_subtitle_cues(
                &request.source_cues,
                &request.translated_cues,
            ) {
                Ok(cues) => cues,
                Err(error) => {
                    return subtitle_cache_write_error_response(
                        request.request_id,
                        "INVALID_MESSAGE",
                        error.to_string(),
                        false,
                    );
                }
            };

            match cache.write(&key, &request.source_cues, &translated_cues) {
                Ok(()) => json!({
                    "type": "SUBTITLE_CACHE_WRITE_RESULT",
                    "requestId": request.request_id,
                    "ok": true
                }),
                Err(error) => subtitle_cache_write_error_response(
                    request.request_id,
                    "CACHE_ERROR",
                    error.to_string(),
                    true,
                ),
            }
        }
        _ => subtitle_cache_write_error_response(
            request_id.unwrap_or_default(),
            "INVALID_MESSAGE",
            "WRITE_SUBTITLE_TRANSLATION_CACHE message is missing required fields.",
            false,
        ),
    }
}

fn translate_subtitles(value: Value, request_id: Option<String>, deps: BridgeDeps) -> Value {
    let request = serde_json::from_value::<TranslateSubtitlesRequest>(value);

    match request {
        Ok(request)
            if !request.target_lang.trim().is_empty()
                && !request.video_id.trim().is_empty()
                && !request.source_track_identity.trim().is_empty()
                && !request.source_timeline_hash.trim().is_empty()
                && !request.cues.is_empty() =>
        {
            translate_subtitles_valid(request, deps)
        }
        _ => json!({
            "type": "SUBTITLE_TRANSLATE_RESULT",
            "requestId": request_id.unwrap_or_default(),
            "ok": false,
            "error": "INVALID_MESSAGE",
            "message": "TRANSLATE_SUBTITLES message is missing required fields.",
            "retryable": false,
            "elapsedMs": 0
        }),
    }
}

fn translate_subtitles_valid(request: TranslateSubtitlesRequest, deps: BridgeDeps) -> Value {
    let registry = ProviderRegistry::new(deps.env.clone());
    let timeout_ms = request.timeout_ms.unwrap_or(30_000).max(1);
    let provider_selection = request.provider.clone();
    let effective_provider = resolve_provider_id(provider_selection.as_deref());
    let debug_logging = request.debug_logging.unwrap_or(false);
    let cache_enabled = request.cache_enabled.unwrap_or(true);
    let model = request.model.clone().unwrap_or_default();
    let key = subtitle_cache_key(
        effective_provider,
        request.model.as_deref().unwrap_or("default"),
        &request.target_lang,
        &request.video_id,
        &request.source_track_identity,
        &request.source_timeline_hash,
        request.prompt_version,
    );
    let cache = SqliteSubtitleTranslationCache::new(
        resolve_translation_cache_path_from_env(&deps.env),
        current_time_millis,
    );

    log_debug_event(
        &deps.env,
        debug_logging,
        "subtitle_translation.start",
        json!({
            "requestId": request.request_id,
            "provider": effective_provider.as_str(),
            "model": model,
            "targetLang": request.target_lang,
            "promptVersion": request.prompt_version,
            "timeoutMs": timeout_ms,
            "cacheEnabled": cache_enabled,
            "cueCount": request.cues.len()
        }),
    );

    if cache_enabled {
        if let Ok(Some(hit)) = cache.lookup(&key) {
            return json!({
                "type": "SUBTITLE_TRANSLATE_RESULT",
                "requestId": request.request_id,
                "ok": true,
                "provider": effective_provider.as_str(),
                "cues": hit.cues,
                "cached": true,
                "elapsedMs": 0
            });
        }
    }

    let mut translated_cues = Vec::new();
    let mut elapsed_ms = 0_u64;
    let mut response_provider = effective_provider;

    let uses_explicit_context = request.context_before.is_some() || request.context_after.is_some();
    for chunk in plan_subtitle_chunks_for_request(&request) {
        let chunk_started_at = Instant::now();
        let prompt = build_subtitle_translation_prompt(&chunk, &request.target_lang);
        let provider_result = subtitle_provider_timeout_budget_ms(
            &deps,
            debug_logging,
            &request.request_id,
            chunk_started_at,
            timeout_ms,
            "chunk",
            Some(chunk.index),
        )
        .and_then(|remaining_timeout_ms| {
            registry.run_prompt(
                provider_selection.as_deref(),
                ProviderPromptRequest {
                    prompt: prompt.clone(),
                    model: request.model.clone(),
                    timeout_ms: remaining_timeout_ms,
                },
            )
        });

        let (provider, result) = match provider_result {
            Ok(result) => result,
            Err(error) => {
                log_provider_error(&deps.env, debug_logging, &request.request_id, &error);
                return subtitle_provider_error_response(request.request_id, error);
            }
        };

        response_provider = provider;
        elapsed_ms = elapsed_ms.saturating_add(result.elapsed_ms);

        let parsed_cues = match parse_subtitle_translation_output_allowing_quality_issues(
            &chunk.cues,
            &result.text,
        ) {
            Ok(cues) => Ok(cues),
            Err(first_error) => {
                log_debug_event(
                    &deps.env,
                    debug_logging,
                    "subtitle_translation.structural_retry_start",
                    json!({
                        "requestId": request.request_id,
                        "chunkIndex": chunk.index,
                        "error": first_error.code()
                    }),
                );

                let retry_result = subtitle_provider_timeout_budget_ms(
                    &deps,
                    debug_logging,
                    &request.request_id,
                    chunk_started_at,
                    timeout_ms,
                    "chunk_structural_retry",
                    Some(chunk.index),
                )
                .and_then(|remaining_timeout_ms| {
                    registry.run_prompt(
                        provider_selection.as_deref(),
                        ProviderPromptRequest {
                            prompt,
                            model: request.model.clone(),
                            timeout_ms: remaining_timeout_ms,
                        },
                    )
                });

                let (provider, result) = match retry_result {
                    Ok(result) => result,
                    Err(error) => {
                        log_provider_error(&deps.env, debug_logging, &request.request_id, &error);
                        return subtitle_provider_error_response(request.request_id, error);
                    }
                };

                response_provider = provider;
                elapsed_ms = elapsed_ms.saturating_add(result.elapsed_ms);
                parse_subtitle_translation_output_allowing_quality_issues(&chunk.cues, &result.text)
            }
        };

        match parsed_cues {
            Ok(mut cues) => {
                let quality_issues = audit_subtitle_translation_quality(&chunk.cues, &cues);

                if !quality_issues.is_empty() {
                    match repair_subtitle_quality_issues(
                        &deps,
                        debug_logging,
                        &request.request_id,
                        &registry,
                        provider_selection.as_deref(),
                        &request.model,
                        &request.target_lang,
                        timeout_ms,
                        chunk_started_at,
                        "chunk",
                        &chunk,
                        &mut cues,
                        quality_issues,
                    ) {
                        Ok((provider, repair_elapsed_ms)) => {
                            if let Some(provider) = provider {
                                response_provider = provider;
                            }
                            elapsed_ms = elapsed_ms.saturating_add(repair_elapsed_ms);
                        }
                        Err(error) => {
                            log_provider_error(
                                &deps.env,
                                debug_logging,
                                &request.request_id,
                                &error,
                            );
                            return subtitle_provider_error_response(request.request_id, error);
                        }
                    }
                }

                translated_cues.append(&mut cues);
            }
            Err(error) => {
                log_provider_error(&deps.env, debug_logging, &request.request_id, &error);
                return subtitle_provider_error_response(request.request_id, error);
            }
        }
    }

    let timeline_quality_issues = if uses_explicit_context {
        Vec::new()
    } else {
        audit_subtitle_translation_quality(&request.cues, &translated_cues)
    };
    if !timeline_quality_issues.is_empty() {
        let timeline_repair_started_at = Instant::now();
        let timeline_chunk = SubtitleChunk {
            index: usize::MAX,
            cues: request.cues.clone(),
            context_before: request.context_before.clone().unwrap_or_default(),
            context_after: request.context_after.clone().unwrap_or_default(),
        };
        match repair_subtitle_quality_issues(
            &deps,
            debug_logging,
            &request.request_id,
            &registry,
            provider_selection.as_deref(),
            &request.model,
            &request.target_lang,
            timeout_ms,
            timeline_repair_started_at,
            "timeline",
            &timeline_chunk,
            &mut translated_cues,
            timeline_quality_issues,
        ) {
            Ok((provider, repair_elapsed_ms)) => {
                if let Some(provider) = provider {
                    response_provider = provider;
                }
                elapsed_ms = elapsed_ms.saturating_add(repair_elapsed_ms);
            }
            Err(error) => {
                log_provider_error(&deps.env, debug_logging, &request.request_id, &error);
                return subtitle_provider_error_response(request.request_id, error);
            }
        }
    }

    if cache_enabled {
        match cache.write(&key, &request.cues, &translated_cues) {
            Ok(()) => log_debug_event(
                &deps.env,
                debug_logging,
                "subtitle_cache.write",
                json!({"requestId": request.request_id}),
            ),
            Err(error) => log_debug_event(
                &deps.env,
                debug_logging,
                "subtitle_cache.write_failed",
                json!({
                    "requestId": request.request_id,
                    "message": error.to_string()
                }),
            ),
        }
    }

    json!({
        "type": "SUBTITLE_TRANSLATE_RESULT",
        "requestId": request.request_id,
        "ok": true,
        "provider": response_provider.as_str(),
        "cues": translated_cues,
        "cached": false,
        "elapsedMs": elapsed_ms
    })
}

#[allow(clippy::too_many_arguments)]
fn repair_subtitle_quality_issues(
    deps: &BridgeDeps,
    debug_logging: bool,
    request_id: &str,
    registry: &ProviderRegistry,
    provider_selection: Option<&str>,
    model: &Option<String>,
    target_lang: &str,
    timeout_ms: u64,
    request_started_at: Instant,
    scope: &str,
    chunk: &SubtitleChunk,
    cues: &mut Vec<TranslatedSubtitleCue>,
    quality_issues: Vec<SubtitleQualityIssue>,
) -> Result<(Option<ProviderId>, u64), ProviderError> {
    let mut remaining_issues = quality_issues;
    let mut elapsed_ms = 0_u64;
    let mut response_provider = None;

    for repair_attempt in 0..2 {
        let Some(targeted_chunk) = create_subtitle_quality_repair_chunk(chunk, &remaining_issues)
        else {
            break;
        };

        log_debug_event(
            &deps.env,
            debug_logging,
            if repair_attempt == 0 {
                "subtitle_translation.quality_repair_start"
            } else {
                "subtitle_translation.quality_repair_retry_start"
            },
            json!({
                "requestId": request_id,
                "chunkIndex": chunk.index,
                "scope": scope,
                "targetCueCount": targeted_chunk.cues.len(),
                "issueCount": remaining_issues.len(),
                "issues": summarize_subtitle_quality_issues(&remaining_issues)
            }),
        );

        let target_ids = targeted_chunk
            .cues
            .iter()
            .map(|cue| cue.id.as_str())
            .collect::<HashSet<_>>();
        let current_targeted_cues = cues
            .iter()
            .filter(|cue| target_ids.contains(cue.id.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        let repair_prompt = build_subtitle_repair_prompt(
            &targeted_chunk,
            &current_targeted_cues,
            &remaining_issues,
            target_lang,
        );
        let (provider, result) = registry.run_prompt(
            provider_selection,
            ProviderPromptRequest {
                prompt: repair_prompt.clone(),
                model: model.clone(),
                timeout_ms: subtitle_provider_timeout_budget_ms(
                    deps,
                    debug_logging,
                    request_id,
                    request_started_at,
                    timeout_ms,
                    "quality_repair",
                    Some(chunk.index),
                )?,
            },
        )?;

        response_provider = Some(provider);
        elapsed_ms = elapsed_ms.saturating_add(result.elapsed_ms);

        let targeted_cues =
            match validate_subtitle_translation_output(&targeted_chunk.cues, &result.text) {
                Ok(cues) => cues,
                Err(first_error) => {
                    log_debug_event(
                        &deps.env,
                        debug_logging,
                        "subtitle_translation.quality_repair_structural_retry_start",
                        json!({
                            "requestId": request_id,
                            "chunkIndex": chunk.index,
                            "scope": scope,
                            "error": first_error.code()
                        }),
                    );
                    let (provider, result) = registry.run_prompt(
                        provider_selection,
                        ProviderPromptRequest {
                            prompt: repair_prompt,
                            model: model.clone(),
                            timeout_ms: subtitle_provider_timeout_budget_ms(
                                deps,
                                debug_logging,
                                request_id,
                                request_started_at,
                                timeout_ms,
                                "quality_repair_structural_retry",
                                Some(chunk.index),
                            )?,
                        },
                    )?;
                    response_provider = Some(provider);
                    elapsed_ms = elapsed_ms.saturating_add(result.elapsed_ms);
                    validate_subtitle_translation_output(&targeted_chunk.cues, &result.text)?
                }
            };
        let targeted_issues =
            audit_subtitle_translation_quality(&targeted_chunk.cues, &targeted_cues);
        let mut targeted_by_id = targeted_cues
            .into_iter()
            .map(|cue| (cue.id.clone(), cue))
            .collect::<HashMap<_, _>>();

        for cue in cues.iter_mut() {
            if let Some(targeted) = targeted_by_id.remove(&cue.id) {
                *cue = targeted;
            }
        }

        remaining_issues = if targeted_issues.is_empty() {
            audit_subtitle_translation_quality(&chunk.cues, cues)
        } else {
            targeted_issues
        };

        if remaining_issues.is_empty() {
            break;
        }
    }

    if !remaining_issues.is_empty() {
        return Err(ProviderError::OutputParseFailed {
            message: format!(
                "Subtitle quality repair did not resolve cue alignment issues: {}",
                summarize_subtitle_quality_issues(&remaining_issues)
            ),
        });
    }

    Ok((response_provider, elapsed_ms))
}

fn remaining_subtitle_request_timeout_ms(
    request_started_at: Instant,
    timeout_ms: u64,
) -> Result<u64, ProviderError> {
    let elapsed_ms = request_started_at
        .elapsed()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64;

    if elapsed_ms >= timeout_ms {
        return Err(ProviderError::Timeout { elapsed_ms });
    }

    Ok((timeout_ms - elapsed_ms).max(1))
}

#[allow(clippy::too_many_arguments)]
fn subtitle_provider_timeout_budget_ms(
    deps: &BridgeDeps,
    debug_logging: bool,
    request_id: &str,
    request_started_at: Instant,
    timeout_ms: u64,
    phase: &str,
    chunk_index: Option<usize>,
) -> Result<u64, ProviderError> {
    let remaining_timeout_ms =
        remaining_subtitle_request_timeout_ms(request_started_at, timeout_ms)?;
    let mut fields = json!({
        "requestId": request_id,
        "phase": phase,
        "timeoutMs": timeout_ms,
        "remainingTimeoutMs": remaining_timeout_ms
    });

    if let Some(chunk_index) = chunk_index.filter(|value| *value != usize::MAX) {
        fields["chunkIndex"] = json!(chunk_index);
    }

    log_debug_event(
        &deps.env,
        debug_logging,
        "subtitle_translation.provider_timeout_budget",
        fields,
    );

    Ok(remaining_timeout_ms)
}

fn plan_subtitle_chunks_for_request(request: &TranslateSubtitlesRequest) -> Vec<SubtitleChunk> {
    if request.context_before.is_some() || request.context_after.is_some() {
        return vec![SubtitleChunk {
            index: 0,
            cues: request.cues.clone(),
            context_before: request.context_before.clone().unwrap_or_default(),
            context_after: request.context_after.clone().unwrap_or_default(),
        }];
    }

    plan_subtitle_chunks(&request.cues)
}

fn subtitle_cache_key(
    provider: crate::messages::ProviderId,
    model: &str,
    target_lang: &str,
    video_id: &str,
    source_track_identity: &str,
    source_timeline_hash: &str,
    prompt_version: u64,
) -> SubtitleCacheKey {
    SubtitleCacheKey {
        provider,
        model: model.to_string(),
        target_lang: target_lang.to_string(),
        video_id: video_id.to_string(),
        source_track_identity: source_track_identity.to_string(),
        source_timeline_hash: source_timeline_hash.to_string(),
        prompt_version,
    }
}

fn log_provider_error(
    env: &BTreeMap<String, String>,
    enabled: bool,
    request_id: &str,
    error: &ProviderError,
) {
    let elapsed_ms = match error {
        ProviderError::ExitNonzero { elapsed_ms, .. } | ProviderError::Timeout { elapsed_ms } => {
            *elapsed_ms
        }
        _ => 0,
    };

    log_debug_event(
        env,
        enabled,
        "translation.error",
        json!({
            "requestId": request_id,
            "error": error.code(),
            "retryable": error.retryable(),
            "elapsedMs": elapsed_ms,
            "message": summarize_provider_error_for_log(error)
        }),
    );
}

fn summarize_provider_error_for_log(error: &ProviderError) -> String {
    match error.code() {
        "PROVIDER_NOT_FOUND" => "Provider binary was not found.".to_string(),
        "PROVIDER_TIMEOUT" => "Provider process timed out.".to_string(),
        "PROVIDER_EXIT_NONZERO" => "Provider exited with a non-zero status.".to_string(),
        "PROVIDER_OUTPUT_PARSE_FAILED" => "Provider output could not be parsed.".to_string(),
        _ => error
            .to_string()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" "),
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

fn subtitle_provider_error_response(request_id: String, error: ProviderError) -> Value {
    let elapsed_ms = match &error {
        ProviderError::ExitNonzero { elapsed_ms, .. } | ProviderError::Timeout { elapsed_ms } => {
            *elapsed_ms
        }
        _ => 0,
    };

    json!({
        "type": "SUBTITLE_TRANSLATE_RESULT",
        "requestId": request_id,
        "ok": false,
        "error": error.code(),
        "message": error.to_string(),
        "retryable": error.retryable(),
        "elapsedMs": elapsed_ms
    })
}

fn subtitle_cache_error_response(
    request_id: String,
    error: &str,
    message: impl Into<String>,
    retryable: bool,
) -> Value {
    json!({
        "type": "SUBTITLE_CACHE_RESULT",
        "requestId": request_id,
        "ok": false,
        "error": error,
        "message": message.into(),
        "retryable": retryable
    })
}

fn subtitle_cache_write_error_response(
    request_id: String,
    error: &str,
    message: impl Into<String>,
    retryable: bool,
) -> Value {
    json!({
        "type": "SUBTITLE_CACHE_WRITE_RESULT",
        "requestId": request_id,
        "ok": false,
        "error": error,
        "message": message.into(),
        "retryable": retryable
    })
}

fn current_time_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().try_into().unwrap_or(i64::MAX))
        .unwrap_or(0)
}

fn cache_clear(request_id: Option<String>, deps: BridgeDeps) -> Value {
    let request_id = request_id.unwrap_or_default();
    let cache_path = resolve_translation_cache_path_from_env(&deps.env);
    let text_cache = SqliteTranslationCache::new(cache_path.clone(), current_time_millis);
    let subtitle_cache = SqliteSubtitleTranslationCache::new(cache_path, current_time_millis);
    let text_result = text_cache.clear();
    let subtitle_result = subtitle_cache.clear();

    match (text_result, subtitle_result) {
        (Ok(text), Ok(subtitle)) => json!({
            "type": "CACHE_CLEAR_RESULT",
            "requestId": request_id,
            "ok": true,
            "deletedRows": text.deleted_rows + subtitle.deleted_rows
        }),
        (Err(error), _) | (_, Err(error)) => json!({
            "type": "CACHE_CLEAR_RESULT",
            "requestId": request_id,
            "ok": false,
            "error": "CACHE_ERROR",
            "message": error.to_string(),
            "retryable": true
        }),
    }
}

fn debug_log_info(request_id: Option<String>, deps: BridgeDeps) -> Value {
    match read_debug_log_info(&deps.env) {
        Ok(info) => json!({
            "type": "DEBUG_LOG_INFO_RESULT",
            "requestId": request_id.unwrap_or_default(),
            "ok": true,
            "logPath": info.log_path.display().to_string(),
            "exists": info.exists,
            "sizeBytes": info.size_bytes
        }),
        Err(error) => {
            debug_log_error_response("DEBUG_LOG_INFO_RESULT", request_id, error.to_string())
        }
    }
}

fn debug_log_clear(request_id: Option<String>, deps: BridgeDeps) -> Value {
    match clear_debug_log(&deps.env) {
        Ok(info) => json!({
            "type": "DEBUG_LOG_CLEAR_RESULT",
            "requestId": request_id.unwrap_or_default(),
            "ok": true,
            "logPath": info.log_path.display().to_string(),
            "exists": info.exists,
            "sizeBytes": info.size_bytes
        }),
        Err(error) => {
            debug_log_error_response("DEBUG_LOG_CLEAR_RESULT", request_id, error.to_string())
        }
    }
}

fn debug_log_content(value: Value, request_id: Option<String>, deps: BridgeDeps) -> Value {
    let request = serde_json::from_value::<DebugLogContentRequest>(value);
    let Ok(request) = request else {
        return json!({
            "type": "DEBUG_LOG_CONTENT_RESULT",
            "requestId": request_id.unwrap_or_default(),
            "ok": false,
            "error": "INVALID_MESSAGE",
            "message": "GET_DEBUG_LOG_CONTENT message is missing required fields.",
            "retryable": false
        });
    };

    match read_debug_log_tail(&deps.env, request.max_bytes, request.max_lines) {
        Ok(result) => json!({
            "type": "DEBUG_LOG_CONTENT_RESULT",
            "requestId": request.request_id,
            "ok": true,
            "logPath": result.info.log_path.display().to_string(),
            "exists": result.info.exists,
            "sizeBytes": result.info.size_bytes,
            "content": result.content,
            "truncated": result.truncated
        }),
        Err(error) => debug_log_error_response(
            "DEBUG_LOG_CONTENT_RESULT",
            Some(request.request_id),
            error.to_string(),
        ),
    }
}

fn debug_log_write(value: Value, request_id: Option<String>, deps: BridgeDeps) -> Value {
    let request = serde_json::from_value::<DebugLogWriteRequest>(value);
    let Ok(request) = request else {
        return json!({
            "type": "DEBUG_LOG_WRITE_RESULT",
            "requestId": request_id.unwrap_or_default(),
            "ok": false,
            "error": "INVALID_MESSAGE",
            "message": "WRITE_DEBUG_LOG message is missing required fields.",
            "retryable": false
        });
    };

    if request.event.trim().is_empty() || request.event.len() > 120 {
        return json!({
            "type": "DEBUG_LOG_WRITE_RESULT",
            "requestId": request.request_id,
            "ok": false,
            "error": "INVALID_MESSAGE",
            "message": "WRITE_DEBUG_LOG message is missing required fields.",
            "retryable": false
        });
    }

    json!({
        "type": "DEBUG_LOG_WRITE_RESULT",
        "requestId": request.request_id,
        "ok": true,
        "written": write_debug_log_event(
            &deps.env,
            &request.event,
            request.fields.as_ref()
        )
    })
}

fn debug_log_error_response(
    message_type: &str,
    request_id: Option<String>,
    message: String,
) -> Value {
    json!({
        "type": message_type,
        "requestId": request_id.unwrap_or_default(),
        "ok": false,
        "error": "DEBUG_LOG_ERROR",
        "message": message,
        "retryable": true
    })
}

fn update_error_response(message_type: &str, request_id: String, error: UpdateFailure) -> Value {
    json!({
        "type": message_type,
        "requestId": request_id,
        "ok": false,
        "error": error.code,
        "message": error.message,
        "retryable": error.retryable
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
