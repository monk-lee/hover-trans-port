use hover_trans_port_helper::bridge::{handle_request, BridgeDeps};
use hover_trans_port_helper::messages::NATIVE_BRIDGE_VERSION;
use serde_json::json;
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::symlink;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use tempfile::tempdir;

#[test]
fn ping_returns_pong_with_same_request_id() {
    let response = handle_request(
        json!({"type":"PING","requestId":"req-ping"}),
        BridgeDeps::test(),
    );

    assert_eq!(response["type"], "PONG");
    assert_eq!(response["requestId"], "req-ping");
    assert_eq!(response["ok"], true);
    assert_eq!(response["bridgeVersion"], NATIVE_BRIDGE_VERSION);
}

#[test]
fn unsupported_type_returns_error() {
    let response = handle_request(
        json!({"type":"NOPE","requestId":"req-nope"}),
        BridgeDeps::test(),
    );

    assert_eq!(response["type"], "ERROR");
    assert_eq!(response["requestId"], "req-nope");
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"], "UNSUPPORTED_MESSAGE");
    assert_eq!(response["retryable"], false);
}

#[test]
fn invalid_translate_without_target_lang_returns_translate_result_error() {
    let response = handle_request(
        json!({"type":"TRANSLATE","requestId":"req-translate","text":"Hello"}),
        BridgeDeps::test(),
    );

    assert_eq!(response["type"], "TRANSLATE_RESULT");
    assert_eq!(response["requestId"], "req-translate");
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"], "INVALID_MESSAGE");
    assert_eq!(response["retryable"], false);
}

#[test]
fn provider_status_returns_all_provider_ids() {
    let response = handle_request(
        json!({"type":"PROVIDER_STATUS","requestId":"req-providers"}),
        BridgeDeps::test(),
    );

    assert_eq!(response["type"], "PROVIDER_STATUS_RESULT");
    assert_eq!(response["requestId"], "req-providers");
    assert_eq!(response["ok"], true);

    let providers = response["providers"].as_array().unwrap();
    let ids = providers
        .iter()
        .map(|provider| provider["id"].as_str().unwrap())
        .collect::<Vec<_>>();

    assert_eq!(
        ids,
        vec!["codex", "claude", "gemini", "opencode", "antigravity"]
    );
}

#[test]
fn provider_status_with_provider_returns_only_selected_provider() {
    let temp = tempdir().unwrap();
    let codex = fixture_path("codex");
    make_executable(&codex);

    let agy = temp.path().join("agy");
    let agy_marker = temp.path().join("agy-ran");
    fs::write(
        &agy,
        format!("#!/bin/sh\ntouch '{}'\nexit 42\n", agy_marker.display()),
    )
    .unwrap();
    make_executable(&agy);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_CODEX_PATH".to_string(),
        codex.to_string_lossy().into_owned(),
    );
    env.insert(
        "HOVER_TRANS_PORT_ANTIGRAVITY_PATH".to_string(),
        agy.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    env.insert("HOME".to_string(), temp.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "PROVIDER_STATUS",
            "requestId": "req-codex-status",
            "provider": "codex"
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "PROVIDER_STATUS_RESULT");
    assert_eq!(response["requestId"], "req-codex-status");
    assert_eq!(response["ok"], true);

    let providers = response["providers"].as_array().unwrap();
    assert_eq!(providers.len(), 1);
    assert_eq!(providers[0]["id"], "codex");
    assert_eq!(providers[0]["available"], true);
    assert!(
        !agy_marker.exists(),
        "unselected Antigravity provider should not run"
    );
}

#[test]
fn provider_models_returns_catalog_for_selected_provider() {
    let codex = fixture_path("codex");
    make_executable(&codex);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_CODEX_PATH".to_string(),
        codex.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());

    let response = handle_request(
        json!({
            "type": "PROVIDER_MODELS",
            "requestId": "req-models",
            "provider": "codex"
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "PROVIDER_MODELS_RESULT");
    assert_eq!(response["requestId"], "req-models");
    assert_eq!(response["ok"], true);
    assert_eq!(response["catalog"]["provider"], "codex");
    assert_eq!(response["catalog"]["defaultModel"], "gpt-5.3-codex-spark");
    assert!(response["catalog"]["models"]
        .as_array()
        .unwrap()
        .iter()
        .any(|model| model["value"] == "gpt-5.3-codex-spark" && model["recommended"] == true));
}

#[test]
fn cached_claude_and_codex_translations_do_not_collide() {
    let codex = fixture_path("codex");
    let claude = fixture_path("claude");
    make_executable(&codex);
    make_executable(&claude);

    let temp = tempdir().unwrap();
    let cache_path = temp.path().join("cache.sqlite");

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_CODEX_PATH".to_string(),
        codex.to_string_lossy().into_owned(),
    );
    env.insert(
        "HOVER_TRANS_PORT_CLAUDE_PATH".to_string(),
        claude.to_string_lossy().into_owned(),
    );
    env.insert(
        "HOVER_TRANS_PORT_CACHE_PATH".to_string(),
        cache_path.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    env.insert("HOME".to_string(), temp.path().display().to_string());

    let codex_first = translate_with_provider("req-codex-first", "codex", env.clone());
    assert_eq!(codex_first["type"], "TRANSLATE_RESULT");
    assert_eq!(codex_first["requestId"], "req-codex-first");
    assert_eq!(codex_first["ok"], true);
    assert_eq!(codex_first["provider"], "codex");
    assert_eq!(codex_first["translatedText"], "안녕하세요");
    assert_eq!(codex_first["cached"], false);

    let claude_first = translate_with_provider("req-claude-first", "claude", env.clone());
    assert_eq!(claude_first["type"], "TRANSLATE_RESULT");
    assert_eq!(claude_first["requestId"], "req-claude-first");
    assert_eq!(claude_first["ok"], true);
    assert_eq!(claude_first["provider"], "claude");
    assert_eq!(claude_first["translatedText"], "클로드 안녕하세요");
    assert_eq!(claude_first["cached"], false);

    let claude_second = translate_with_provider("req-claude-second", "claude", env.clone());
    assert_eq!(claude_second["type"], "TRANSLATE_RESULT");
    assert_eq!(claude_second["requestId"], "req-claude-second");
    assert_eq!(claude_second["ok"], true);
    assert_eq!(claude_second["provider"], "claude");
    assert_eq!(claude_second["translatedText"], "클로드 안녕하세요");
    assert_eq!(claude_second["cached"], true);

    let codex_second = translate_with_provider("req-codex-second", "codex", env);
    assert_eq!(codex_second["type"], "TRANSLATE_RESULT");
    assert_eq!(codex_second["requestId"], "req-codex-second");
    assert_eq!(codex_second["ok"], true);
    assert_eq!(codex_second["provider"], "codex");
    assert_eq!(codex_second["translatedText"], "안녕하세요");
    assert_eq!(codex_second["cached"], true);
}

#[test]
fn subtitle_cache_miss_returns_cached_false() {
    let temp = tempdir().unwrap();
    let cache_path = temp.path().join("cache.sqlite");
    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_CACHE_PATH".to_string(),
        cache_path.to_string_lossy().into_owned(),
    );
    env.insert("HOME".to_string(), temp.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "GET_SUBTITLE_TRANSLATION_CACHE",
            "requestId": "req-sub-cache",
            "provider": "codex",
            "model": "gpt-5.4-mini",
            "targetLang": "Korean",
            "videoId": "abc",
            "sourceTrackIdentity": "track",
            "sourceTimelineHash": "hash",
            "promptVersion": 3
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "SUBTITLE_CACHE_RESULT");
    assert_eq!(response["requestId"], "req-sub-cache");
    assert_eq!(response["ok"], true);
    assert_eq!(response["cached"], false);
}

#[test]
fn subtitle_translation_writes_and_reuses_cache() {
    let temp = tempdir().unwrap();
    let cache_path = temp.path().join("cache.sqlite");
    let codex = temp.path().join("codex-subtitle");
    fs::write(
        &codex,
        r#"#!/bin/sh
if [ "$1" = "exec" ]; then
  prompt="$(/bin/cat)"
  case "$prompt" in
    *'"cue-0"'*)
      printf '%s' '{"cues":[{"id":"cue-0","translatedText":"안녕"}]}'
      exit 0
      ;;
  esac
fi
printf 'unexpected subtitle prompt' >&2
exit 2
"#,
    )
    .unwrap();
    make_executable(&codex);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_CODEX_PATH".to_string(),
        codex.to_string_lossy().into_owned(),
    );
    env.insert(
        "HOVER_TRANS_PORT_CACHE_PATH".to_string(),
        cache_path.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    env.insert("HOME".to_string(), temp.path().display().to_string());

    let first = subtitle_translate("req-sub-first", env.clone());
    assert_eq!(first["type"], "SUBTITLE_TRANSLATE_RESULT");
    assert_eq!(first["requestId"], "req-sub-first");
    assert_eq!(first["ok"], true);
    assert_eq!(first["provider"], "codex");
    assert_eq!(first["cached"], false);
    assert_eq!(first["cues"][0]["id"], "cue-0");
    assert_eq!(first["cues"][0]["translatedText"], "안녕");

    let second = subtitle_translate("req-sub-second", env);
    assert_eq!(second["type"], "SUBTITLE_TRANSLATE_RESULT");
    assert_eq!(second["requestId"], "req-sub-second");
    assert_eq!(second["ok"], true);
    assert_eq!(second["cached"], true);
    assert_eq!(second["cues"][0]["translatedText"], "안녕");
}

#[test]
fn subtitle_translation_repairs_quality_risk_before_caching() {
    let temp = tempdir().unwrap();
    let cache_path = temp.path().join("cache.sqlite");
    let codex = temp.path().join("codex-subtitle-repair");
    fs::write(
        &codex,
        r#"#!/bin/sh
if [ "$1" = "exec" ]; then
  prompt="$(/bin/cat)"
  case "$prompt" in
    *'"qualityIssues"'*)
      printf '%s' '{"cues":[{"id":"cue-tool","translatedText":"Xcode를 열고"},{"id":"cue-start","translatedText":"미리보기에서 시작하세요"}]}'
      exit 0
      ;;
	    *'"cuesToTranslate"'*)
	      printf '%s' '{"cues":[{"id":"cue-tool","translatedText":"도구를 열고"},{"id":"cue-start","translatedText":"미리보기에서 시작해"}]}'
      exit 0
      ;;
  esac
fi
printf 'unexpected subtitle repair prompt' >&2
exit 2
"#,
    )
    .unwrap();
    make_executable(&codex);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_CODEX_PATH".to_string(),
        codex.to_string_lossy().into_owned(),
    );
    env.insert(
        "HOVER_TRANS_PORT_CACHE_PATH".to_string(),
        cache_path.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    env.insert("HOME".to_string(), temp.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "TRANSLATE_SUBTITLES",
            "requestId": "req-sub-repair",
            "provider": "codex",
            "model": "gpt-5.4-mini",
            "targetLang": "Korean",
            "videoId": "abc",
            "sourceTrackIdentity": "track",
            "sourceTimelineHash": "hash-repair",
            "promptVersion": 1,
            "cacheEnabled": true,
            "timeoutMs": 5_000,
            "cues": [
                {
                    "id": "cue-tool",
                    "startMs": 0,
                    "endMs": 2_000,
                    "text": "open Xcode"
                },
                {
                    "id": "cue-start",
                    "startMs": 2_000,
                    "endMs": 4_000,
                    "text": "and start from the preview"
                }
            ]
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "SUBTITLE_TRANSLATE_RESULT");
    assert_eq!(response["ok"], true);
    assert_eq!(response["cached"], false);
    assert_eq!(response["cues"][0]["translatedText"], "Xcode를 열고");
    assert_eq!(response["cues"][1]["translatedText"], "미리보기에서 시작해");
}

#[test]
fn subtitle_translation_retries_once_when_provider_returns_malformed_json() {
    let temp = tempdir().unwrap();
    let cache_path = temp.path().join("cache.sqlite");
    let codex = temp.path().join("codex-subtitle-malformed-json");
    fs::write(
        &codex,
        r#"#!/bin/sh
state="$HOME/subtitle-total-timeout.state"
if [ "$1" = "exec" ]; then
  prompt="$(/bin/cat)"
  case "$prompt" in
    *'"cuesToTranslate"'*)
      if [ -f "$state" ]; then
        printf '%s' '{"cues":[{"id":"cue-hello","translatedText":"안녕하세요."}]}'
        exit 0
      fi
      printf malformed > "$state"
      printf '%s' '{"cues":[{"id":"cue-hello","translatedText":"안녕하세요."}'
      exit 0
      ;;
  esac
fi
printf 'unexpected malformed-json retry prompt' >&2
exit 2
"#,
    )
    .unwrap();
    make_executable(&codex);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_CODEX_PATH".to_string(),
        codex.to_string_lossy().into_owned(),
    );
    env.insert(
        "HOVER_TRANS_PORT_CACHE_PATH".to_string(),
        cache_path.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    env.insert("HOME".to_string(), temp.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "TRANSLATE_SUBTITLES",
            "requestId": "req-sub-malformed-json",
            "provider": "codex",
            "model": "gpt-5.4-mini",
            "targetLang": "Korean",
            "videoId": "abc",
            "sourceTrackIdentity": "track",
            "sourceTimelineHash": "hash-malformed-json",
            "promptVersion": 1,
            "cacheEnabled": true,
            "timeoutMs": 5_000,
            "cues": [
                {
                    "id": "cue-hello",
                    "startMs": 1_000,
                    "endMs": 2_000,
                    "text": "hello"
                }
            ]
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "SUBTITLE_TRANSLATE_RESULT");
    assert_eq!(response["ok"], true);
    assert_eq!(response["cues"][0]["translatedText"], "안녕하세요.");
}

#[test]
fn subtitle_translation_repairs_implausibly_long_cue_before_failing() {
    let temp = tempdir().unwrap();
    let cache_path = temp.path().join("cache.sqlite");
    let codex = temp.path().join("codex-subtitle-long-repair");
    fs::write(
        &codex,
        r#"#!/bin/sh
if [ "$1" = "exec" ]; then
  prompt="$(/bin/cat)"
  case "$prompt" in
    *'"qualityIssues"'*)
      printf '%s' '{"cues":[{"id":"cue-next","translatedText":"다음 부분을 확인해 주세요."}]}'
      exit 0
      ;;
    *'"cuesToTranslate"'*)
      printf '%s' '{"cues":[{"id":"cue-next","translatedText":"다음 부분을 확인해 주세요. 그리고 이어지는 단계에서 필요한 설정과 실행 방법, 확인해야 할 결과를 모두 한꺼번에 길게 설명해서 짧은 자막 cue에 담기 어렵게 만든 번역입니다."}]}'
      exit 0
      ;;
  esac
fi
printf 'unexpected subtitle long repair prompt' >&2
exit 2
"#,
    )
    .unwrap();
    make_executable(&codex);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_CODEX_PATH".to_string(),
        codex.to_string_lossy().into_owned(),
    );
    env.insert(
        "HOVER_TRANS_PORT_CACHE_PATH".to_string(),
        cache_path.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    env.insert("HOME".to_string(), temp.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "TRANSLATE_SUBTITLES",
            "requestId": "req-sub-long-repair",
            "provider": "codex",
            "model": "gpt-5.4-mini",
            "targetLang": "Korean",
            "videoId": "abc",
            "sourceTrackIdentity": "track",
            "sourceTimelineHash": "hash-long-repair",
            "promptVersion": 1,
            "cacheEnabled": true,
            "timeoutMs": 5_000,
            "cues": [
                {
                    "id": "cue-next",
                    "startMs": 10_000,
                    "endMs": 12_000,
                    "text": "check the next section"
                }
            ]
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "SUBTITLE_TRANSLATE_RESULT");
    assert_eq!(response["ok"], true);
    assert_eq!(
        response["cues"][0]["translatedText"],
        "다음 부분을 확인해 주세요."
    );
}

#[test]
fn subtitle_translation_retries_quality_repair_when_repair_output_is_invalid() {
    let temp = tempdir().unwrap();
    let cache_path = temp.path().join("cache.sqlite");
    let codex = temp.path().join("codex-subtitle-repair-invalid-once");
    fs::write(
        &codex,
        r#"#!/bin/sh
state="$0.state"
if [ "$1" = "exec" ]; then
  prompt="$(/bin/cat)"
  case "$prompt" in
    *'"qualityIssues"'*)
      if [ -f "$state" ]; then
        printf '%s' '{"cues":[{"id":"cue-tool","translatedText":"Xcode를 열고 프로젝트를 시작하세요"}]}'
        exit 0
      fi
      printf invalid-once > "$state"
      printf '%s' '{"cues":[{"id":"cue-tool","translatedText":"Xcode를 열고 프로젝트를 시작하세요. 이 문장은 일부러 너무 길게 만들어 첫 번째 repair 검증에서 실패하게 합니다. 같은 내용을 계속 덧붙여서 짧은 자막 cue에 들어가기 어려운 길이로 만들고, 구조 재시도에서 정상 repair가 다시 들어오는지 확인합니다. 너무 긴 번역입니다."}]}'
      exit 0
      ;;
    *'"cuesToTranslate"'*)
      printf '%s' '{"cues":[{"id":"cue-tool","translatedText":"도구를 열고 프로젝트를 시작해"}]}'
      exit 0
      ;;
  esac
fi
printf 'unexpected subtitle invalid repair retry prompt' >&2
exit 2
"#,
    )
    .unwrap();
    make_executable(&codex);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_CODEX_PATH".to_string(),
        codex.to_string_lossy().into_owned(),
    );
    env.insert(
        "HOVER_TRANS_PORT_CACHE_PATH".to_string(),
        cache_path.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    env.insert("HOME".to_string(), temp.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "TRANSLATE_SUBTITLES",
            "requestId": "req-sub-repair-invalid-once",
            "provider": "codex",
            "model": "gpt-5.4-mini",
            "targetLang": "Korean",
            "videoId": "abc",
            "sourceTrackIdentity": "track",
            "sourceTimelineHash": "hash-repair-invalid-once",
            "promptVersion": 1,
            "cacheEnabled": true,
            "timeoutMs": 5_000,
            "cues": [
                {
                    "id": "cue-tool",
                    "startMs": 132_000,
                    "endMs": 134_000,
                    "text": "open Xcode and start the project"
                }
            ]
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "SUBTITLE_TRANSLATE_RESULT");
    assert_eq!(response["ok"], true);
    assert_eq!(
        response["cues"][0]["translatedText"],
        "Xcode를 열고 프로젝트를 시작하세요"
    );
}

#[test]
fn subtitle_translation_runs_targeted_repair_when_full_repair_keeps_quality_issues() {
    let temp = tempdir().unwrap();
    let cache_path = temp.path().join("cache.sqlite");
    let codex = temp.path().join("codex-subtitle-targeted-repair");
    fs::write(
        &codex,
        r#"#!/bin/sh
state="$0.state"
if [ "$1" = "exec" ]; then
  prompt="$(/bin/cat)"
  case "$prompt" in
    *'"qualityIssues"'*)
      if [ -f "$state" ]; then
	        printf '%s' '{"cues":[{"id":"cue-tool","translatedText":"Xcode를 열고"},{"id":"cue-start","translatedText":"예제를 시작하세요"}]}'
        exit 0
      fi
      printf repaired-once > "$state"
	      printf '%s' '{"cues":[{"id":"cue-tool","translatedText":"도구를 열고"},{"id":"cue-start","translatedText":"예제를 시작해"}]}'
      exit 0
      ;;
	    *'"cuesToTranslate"'*)
	      printf '%s' '{"cues":[{"id":"cue-tool","translatedText":"도구를 열고"},{"id":"cue-start","translatedText":"예제를 시작해"}]}'
      exit 0
      ;;
  esac
fi
printf 'unexpected subtitle targeted repair prompt' >&2
exit 2
"#,
    )
    .unwrap();
    make_executable(&codex);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_CODEX_PATH".to_string(),
        codex.to_string_lossy().into_owned(),
    );
    env.insert(
        "HOVER_TRANS_PORT_CACHE_PATH".to_string(),
        cache_path.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    env.insert("HOME".to_string(), temp.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "TRANSLATE_SUBTITLES",
            "requestId": "req-sub-targeted-repair",
            "provider": "codex",
            "model": "gpt-5.4-mini",
            "targetLang": "Korean",
            "videoId": "abc",
            "sourceTrackIdentity": "track",
            "sourceTimelineHash": "hash-targeted-repair",
            "promptVersion": 1,
            "cacheEnabled": true,
            "timeoutMs": 5_000,
            "cues": [
                {
                    "id": "cue-tool",
                    "startMs": 132_000,
                    "endMs": 134_000,
                    "text": "open Xcode"
                },
                {
                    "id": "cue-start",
                    "startMs": 134_000,
                    "endMs": 136_000,
                    "text": "and start the example"
                }
            ]
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "SUBTITLE_TRANSLATE_RESULT");
    assert_eq!(response["ok"], true);
    assert_eq!(response["cues"][0]["translatedText"], "Xcode를 열고");
    assert_eq!(response["cues"][1]["translatedText"], "예제를 시작해");
}

#[test]
fn subtitle_translation_starts_quality_repair_with_targeted_issue_span() {
    let temp = tempdir().unwrap();
    let cache_path = temp.path().join("cache.sqlite");
    let codex = temp.path().join("codex-subtitle-targeted-first");
    fs::write(
        &codex,
        r#"#!/bin/sh
if [ "$1" = "exec" ]; then
  prompt="$(/bin/cat)"
  case "$prompt" in
    *'"qualityIssues"'*)
      if printf '%s' "$prompt" | /usr/bin/grep -F '"expectedCueIds":["safe-intro"' >/dev/null; then
        printf 'repair prompt should target only the quality issue span' >&2
        exit 2
      fi
      if printf '%s' "$prompt" | /usr/bin/grep -F '"expectedCueIds":["cue-tool","cue-start"]' >/dev/null; then
        printf '%s' '{"cues":[{"id":"cue-tool","translatedText":"Xcode를 열고"},{"id":"cue-start","translatedText":"미리보기를 시작하세요"}]}'
        exit 0
      fi
      printf 'repair prompt did not use the expected targeted cue ids' >&2
      exit 2
      ;;
	    *'"cuesToTranslate"'*)
	      printf '%s' '{"cues":[{"id":"safe-intro","translatedText":"시작입니다"},{"id":"cue-tool","translatedText":"같은 번역 문장입니다"},{"id":"cue-start","translatedText":"같은 번역 문장입니다"}]}'
      exit 0
      ;;
  esac
fi
printf 'unexpected subtitle targeted-first prompt' >&2
exit 2
"#,
    )
    .unwrap();
    make_executable(&codex);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_CODEX_PATH".to_string(),
        codex.to_string_lossy().into_owned(),
    );
    env.insert(
        "HOVER_TRANS_PORT_CACHE_PATH".to_string(),
        cache_path.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    env.insert("HOME".to_string(), temp.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "TRANSLATE_SUBTITLES",
            "requestId": "req-sub-targeted-first",
            "provider": "codex",
            "model": "gpt-5.4-mini",
            "targetLang": "Korean",
            "videoId": "abc",
            "sourceTrackIdentity": "track",
            "sourceTimelineHash": "hash-targeted-first",
            "promptVersion": 1,
            "cacheEnabled": true,
            "timeoutMs": 5_000,
            "cues": [
                {
                    "id": "safe-intro",
                    "startMs": 27_000,
                    "endMs": 29_000,
                    "text": "we are starting here"
                },
                {
                    "id": "cue-tool",
                    "startMs": 29_000,
                    "endMs": 31_000,
                    "text": "open Xcode"
                },
                {
                    "id": "cue-start",
                    "startMs": 31_000,
                    "endMs": 33_000,
                    "text": "and start the preview"
                }
            ]
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "SUBTITLE_TRANSLATE_RESULT");
    assert_eq!(response["ok"], true);
    assert_eq!(response["cues"][0]["translatedText"], "시작입니다");
    assert_eq!(response["cues"][1]["translatedText"], "Xcode를 열고");
    assert_eq!(
        response["cues"][2]["translatedText"],
        "미리보기를 시작하세요"
    );
}

#[test]
fn subtitle_translation_repairs_quality_issues_across_chunk_boundaries() {
    let temp = tempdir().unwrap();
    let cache_path = temp.path().join("cache.sqlite");
    let codex = temp.path().join("codex-subtitle-timeline-repair");
    fs::write(
        &codex,
        r#"#!/bin/sh
if [ "$1" = "exec" ]; then
  prompt_file="$0.prompt"
  /bin/cat > "$prompt_file"
  prompt="$(/bin/cat "$prompt_file")"
  case "$prompt" in
    *'"qualityIssues"'*)
      if printf '%s' "$prompt" | /usr/bin/grep -F '"expectedCueIds":["cue-23","cue-24"]' >/dev/null; then
        printf '%s' '{"cues":[{"id":"cue-23","translatedText":"첫 번째 설명입니다"},{"id":"cue-24","translatedText":"다음 설명입니다"}]}'
        exit 0
      fi
      printf 'repair prompt did not target the cross-boundary cues' >&2
      exit 2
      ;;
    *'"cuesToTranslate"'*)
      /usr/bin/python3 - "$prompt_file" <<'PY'
import json
import re
import sys

prompt = open(sys.argv[1], encoding="utf-8").read()
payload = json.loads(prompt.split("Input JSON:", 1)[1].strip())
cues = []
for cue_id in payload["expectedCueIds"]:
    number = re.sub(r"^cue-", "", cue_id)
    translated = "같은 번역 문장입니다" if cue_id in {"cue-23", "cue-24"} else f"정상 {number}"
    cues.append({"id": cue_id, "translatedText": translated})
print(json.dumps({"cues": cues}, ensure_ascii=False), end="")
PY
      exit 0
      ;;
  esac
fi
printf 'unexpected subtitle timeline repair prompt' >&2
exit 2
"#,
    )
    .unwrap();
    make_executable(&codex);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_CODEX_PATH".to_string(),
        codex.to_string_lossy().into_owned(),
    );
    env.insert(
        "HOVER_TRANS_PORT_CACHE_PATH".to_string(),
        cache_path.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    env.insert("HOME".to_string(), temp.path().display().to_string());

    let cues = (0..25)
        .map(|index| {
            json!({
                "id": format!("cue-{index}"),
                "startMs": if index < 23 {
                    index * 1000
                } else if index == 23 {
                    59_000
                } else {
                    60_000
                },
                "endMs": if index < 23 {
                    index * 1000 + 800
                } else if index == 23 {
                    59_800
                } else {
                    60_800
                },
                "text": match index {
                    23 => "first boundary point".to_string(),
                    24 => "second boundary point".to_string(),
                    _ => format!("safe cue {index}"),
                }
            })
        })
        .collect::<Vec<_>>();

    let response = handle_request(
        json!({
            "type": "TRANSLATE_SUBTITLES",
            "requestId": "req-sub-timeline-repair",
            "provider": "codex",
            "model": "gpt-5.4-mini",
            "targetLang": "Korean",
            "videoId": "abc",
            "sourceTrackIdentity": "track",
            "sourceTimelineHash": "hash-timeline-repair",
            "promptVersion": 1,
            "cacheEnabled": true,
            "timeoutMs": 5_000,
            "cues": cues
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "SUBTITLE_TRANSLATE_RESULT");
    assert_eq!(response["ok"], true);
    assert_eq!(response["cues"][23]["translatedText"], "첫 번째 설명입니다");
    assert_eq!(response["cues"][24]["translatedText"], "다음 설명입니다");
}

#[test]
fn subtitle_translation_timeout_applies_to_each_subtitle_chunk() {
    let temp = tempdir().unwrap();
    let cache_path = temp.path().join("cache.sqlite");
    let log_path = temp.path().join("hover-trans-port.log");
    let codex = temp.path().join("codex-subtitle-total-timeout");
    fs::write(
        &codex,
        r#"#!/bin/sh
if [ "$1" = "exec" ]; then
  prompt_file="$0.prompt"
  /bin/cat > "$prompt_file"
  ids="$(/usr/bin/python3 - "$prompt_file" <<'PY'
import json
import sys

prompt = open(sys.argv[1], encoding="utf-8").read()
payload = json.loads(prompt.split("Input JSON:", 1)[1].strip())
print("\n".join(payload["expectedCueIds"]))
PY
)"
  if [ "$ids" = "cue-1" ]; then
    /bin/sleep 5
  fi
  printf '{"cues":['
  first=1
  for cue_id in $ids; do
    if [ "$first" = "0" ]; then
      printf ','
    fi
    first=0
    printf '{"id":"%s","translatedText":"번역 %s입니다"}' "$cue_id" "$cue_id"
  done
  printf ']}'
  exit 0
fi

printf 'unexpected subtitle total timeout prompt' >&2
exit 2
"#,
    )
    .unwrap();
    make_executable(&codex);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_CODEX_PATH".to_string(),
        codex.to_string_lossy().into_owned(),
    );
    env.insert(
        "HOVER_TRANS_PORT_CACHE_PATH".to_string(),
        cache_path.to_string_lossy().into_owned(),
    );
    env.insert(
        "HOVER_TRANS_PORT_LOG_PATH".to_string(),
        log_path.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    env.insert("HOME".to_string(), temp.path().display().to_string());

    let cues = vec![
        json!({
            "id": "cue-0",
            "startMs": 0,
            "endMs": 800,
            "text": "subtitle line 0"
        }),
        json!({
            "id": "cue-1",
            "startMs": 61_000,
            "endMs": 61_800,
            "text": "subtitle line 1"
        }),
    ];

    let response = handle_request(
        json!({
            "type": "TRANSLATE_SUBTITLES",
            "requestId": "req-sub-total-timeout",
            "provider": "codex",
            "model": "gpt-5.4-mini",
            "targetLang": "Korean",
            "videoId": "abc",
            "sourceTrackIdentity": "track",
            "sourceTimelineHash": "hash-total-timeout",
            "promptVersion": 1,
            "cacheEnabled": false,
            "debugLogging": true,
            "timeoutMs": 3000,
            "cues": cues
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "SUBTITLE_TRANSLATE_RESULT");
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"], "PROVIDER_TIMEOUT");
    let log_content = fs::read_to_string(log_path).unwrap();
    let timeout_budgets = log_content
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|entry| entry["event"] == "subtitle_translation.provider_timeout_budget")
        .collect::<Vec<_>>();
    assert!(
        timeout_budgets.len() >= 2,
        "expected at least two provider timeout budget logs: {log_content}"
    );
    assert_eq!(timeout_budgets[1]["chunkIndex"], 1);
    let second_timeout_budget = timeout_budgets[1]["remainingTimeoutMs"]
        .as_u64()
        .unwrap_or_default();
    assert!(
        second_timeout_budget >= 2_900,
        "second subtitle chunk should receive a fresh provider timeout budget: {log_content}"
    );
}

#[test]
fn subtitle_translation_structural_retry_shares_native_subtitle_request_timeout() {
    let temp = tempdir().unwrap();
    let cache_path = temp.path().join("cache.sqlite");
    let codex = temp.path().join("codex-subtitle-retry-timeout");
    fs::write(
        &codex,
        r#"#!/bin/sh
state="$0.state"
count=0
if [ -f "$state" ]; then
  count="$(/bin/cat "$state")"
fi
count=$((count + 1))
printf '%s' "$count" > "$state"

if [ "$1" = "exec" ]; then
  /bin/cat > /dev/null
  /bin/sleep 2
  if [ "$count" = "1" ]; then
    printf '%s' '{"cues":[{"id":"cue-hello","translatedText":"안녕하세요."}'
  else
    printf '%s' '{"cues":[{"id":"cue-hello","translatedText":"안녕하세요."}]}'
  fi
  exit 0
fi

printf 'unexpected subtitle retry timeout prompt' >&2
exit 2
"#,
    )
    .unwrap();
    make_executable(&codex);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_CODEX_PATH".to_string(),
        codex.to_string_lossy().into_owned(),
    );
    env.insert(
        "HOVER_TRANS_PORT_CACHE_PATH".to_string(),
        cache_path.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    env.insert("HOME".to_string(), temp.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "TRANSLATE_SUBTITLES",
            "requestId": "req-sub-retry-timeout",
            "provider": "codex",
            "model": "gpt-5.4-mini",
            "targetLang": "Korean",
            "videoId": "abc",
            "sourceTrackIdentity": "track",
            "sourceTimelineHash": "hash-retry-timeout",
            "promptVersion": 1,
            "cacheEnabled": false,
            "timeoutMs": 3000,
            "cues": [
                {
                    "id": "cue-hello",
                    "startMs": 1_000,
                    "endMs": 2_000,
                    "text": "hello"
                }
            ]
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "SUBTITLE_TRANSLATE_RESULT");
    assert_eq!(response["ok"], false, "{response}");
    assert_eq!(response["error"], "PROVIDER_TIMEOUT");
}

#[test]
fn debug_log_write_info_content_and_clear_use_configured_log_path() {
    let temp = tempdir().unwrap();
    let log_path = temp.path().join("debug").join("hover-trans-port.log");
    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_LOG_PATH".to_string(),
        log_path.to_string_lossy().into_owned(),
    );
    env.insert("HOME".to_string(), temp.path().display().to_string());

    let write = handle_request(
        json!({
            "type": "WRITE_DEBUG_LOG",
            "requestId": "req-log-write",
            "event": "content.trigger",
            "fields": {
                "mode": "selection",
                "textLength": 5,
                "ignored": {"nested": true}
            }
        }),
        BridgeDeps::with_env(env.clone()),
    );

    assert_eq!(write["type"], "DEBUG_LOG_WRITE_RESULT");
    assert_eq!(write["requestId"], "req-log-write");
    assert_eq!(write["ok"], true);
    assert_eq!(write["written"], true);

    let info = handle_request(
        json!({"type":"GET_DEBUG_LOG_INFO","requestId":"req-log-info"}),
        BridgeDeps::with_env(env.clone()),
    );
    assert_eq!(info["type"], "DEBUG_LOG_INFO_RESULT");
    assert_eq!(info["requestId"], "req-log-info");
    assert_eq!(info["ok"], true);
    assert_eq!(info["logPath"], log_path.display().to_string());
    assert_eq!(info["exists"], true);
    assert!(info["sizeBytes"].as_u64().unwrap() > 0);

    let content = handle_request(
        json!({
            "type": "GET_DEBUG_LOG_CONTENT",
            "requestId": "req-log-content",
            "maxBytes": 4096,
            "maxLines": 20
        }),
        BridgeDeps::with_env(env.clone()),
    );
    assert_eq!(content["type"], "DEBUG_LOG_CONTENT_RESULT");
    assert_eq!(content["requestId"], "req-log-content");
    assert_eq!(content["ok"], true);
    assert_eq!(content["logPath"], log_path.display().to_string());
    assert_eq!(content["exists"], true);
    assert_eq!(content["truncated"], false);
    let log_content = content["content"].as_str().unwrap();
    assert!(log_content.contains("\"event\":\"content.trigger\""));
    assert!(log_content.contains("\"mode\":\"selection\""));
    assert!(log_content.contains("\"textLength\":5"));
    assert!(!log_content.contains("ignored"));

    let clear = handle_request(
        json!({"type":"CLEAR_DEBUG_LOG","requestId":"req-log-clear"}),
        BridgeDeps::with_env(env.clone()),
    );
    assert_eq!(clear["type"], "DEBUG_LOG_CLEAR_RESULT");
    assert_eq!(clear["requestId"], "req-log-clear");
    assert_eq!(clear["ok"], true);
    assert_eq!(clear["logPath"], log_path.display().to_string());
    assert_eq!(clear["exists"], true);
    assert_eq!(clear["sizeBytes"], 0);
}

#[test]
fn translation_debug_logging_records_provider_execution_events() {
    let claude = fixture_path("claude");
    make_executable(&claude);

    let temp = tempdir().unwrap();
    let log_path = temp.path().join("hover-trans-port.log");
    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_CLAUDE_PATH".to_string(),
        claude.to_string_lossy().into_owned(),
    );
    env.insert(
        "HOVER_TRANS_PORT_LOG_PATH".to_string(),
        log_path.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    env.insert("HOME".to_string(), temp.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "TRANSLATE",
            "requestId": "req-claude-debug",
            "provider": "claude",
            "model": "",
            "targetLang": "Korean",
            "text": "Hello",
            "cacheEnabled": false,
            "debugLogging": true,
            "timeoutMs": 5_000
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "TRANSLATE_RESULT");
    assert_eq!(response["requestId"], "req-claude-debug");
    assert_eq!(response["ok"], true);
    assert_eq!(response["provider"], "claude");

    let log_content = fs::read_to_string(log_path).unwrap();
    assert!(log_content.contains("\"event\":\"translation.start\""));
    assert!(log_content.contains("\"provider\":\"claude\""));
    assert!(log_content.contains("\"event\":\"cache.disabled\""));
    assert!(log_content.contains("\"event\":\"provider.start\""));
    assert!(log_content.contains("\"event\":\"translation.success\""));
    assert!(!log_content.contains("Hello"));
}

#[test]
fn native_host_update_status_reports_available_release() {
    let temp = tempdir().unwrap();
    let releases_path = temp.path().join("releases.json");
    write_release_fixture(
        &releases_path,
        r#"[{
          "tag_name": "v0.2.18",
          "prerelease": false,
          "draft": false,
          "html_url": "https://github.com/monk-lee/hover-trans-port/releases/tag/v0.2.18",
          "assets": [
            {"name": "install-macos-native-host.sh"},
            {"name": "checksums.txt"},
            {"name": "hover-trans-port-helper-macos-arm64"}
          ]
        }]"#,
    );

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_RELEASES_JSON_PATH".to_string(),
        releases_path.to_string_lossy().into_owned(),
    );
    env.insert(
        "HOVER_TRANS_PORT_TEST_ARCH".to_string(),
        "arm64".to_string(),
    );
    env.insert("HOVER_TRANS_PORT_TEST_OS".to_string(), "macos".to_string());

    let response = handle_request(
        json!({"type":"NATIVE_HOST_UPDATE_STATUS","requestId":"req-update-status"}),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "NATIVE_HOST_UPDATE_STATUS_RESULT");
    assert_eq!(response["requestId"], "req-update-status");
    assert_eq!(response["ok"], true);
    assert_eq!(response["installedVersion"], "0.2.17");
    assert_eq!(response["latestVersion"], "0.2.18");
    assert_eq!(response["latestTag"], "v0.2.18");
    assert_eq!(response["updateAvailable"], true);
}

#[test]
fn native_host_update_invokes_persisted_updater() {
    let temp = tempdir().unwrap();
    let install_root = temp.path().join("Hover Trans Port");
    let current_dir = install_root.join("native-hosts/0.2.3");
    fs::create_dir_all(&current_dir).unwrap();
    symlink(&current_dir, install_root.join("current")).unwrap();

    let updater_path = current_dir.join("install-macos-native-host.sh");
    fs::write(
        &updater_path,
        "#!/bin/sh\nprintf '%s\n' '{\"command\":\"update\",\"ok\":true,\"previousVersion\":\"0.2.3\",\"installedVersion\":\"0.2.4\",\"installRoot\":\"/tmp/install\",\"currentLink\":\"/tmp/install/current\",\"helperPath\":\"/tmp/install/native-hosts/0.2.4/hover-trans-port-helper\",\"updaterPath\":\"/tmp/install/native-hosts/0.2.4/install-macos-native-host.sh\",\"manifests\":[]}'\n",
    )
    .unwrap();
    make_executable(&updater_path);

    fs::write(
        install_root.join("current").join("metadata.json"),
        format!(
            "{{\"hostVersion\":\"0.2.3\",\"protocolVersion\":2,\"source\":\"macos-script-installer\",\"updaterPath\":\"{}\"}}",
            updater_path.display()
        ),
    )
    .unwrap();

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_INSTALL_ROOT".to_string(),
        install_root.to_string_lossy().into_owned(),
    );

    let response = handle_request(
        json!({
            "type":"NATIVE_HOST_UPDATE",
            "requestId":"req-update",
            "targetTag":"v0.2.4",
            "targetVersion":"0.2.4"
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "NATIVE_HOST_UPDATE_RESULT");
    assert_eq!(response["requestId"], "req-update");
    assert_eq!(response["ok"], true);
    assert_eq!(response["previousVersion"], "0.2.3");
    assert_eq!(response["installedVersion"], "0.2.4");
}

#[test]
fn native_host_update_invokes_windows_updater_with_powershell_args() {
    let temp = tempdir().unwrap();
    let install_root = temp.path().join("Hover Trans Port");
    let current_dir = install_root.join("native-hosts/0.2.3");
    fs::create_dir_all(&current_dir).unwrap();
    fs::write(install_root.join("current"), "0.2.3\n").unwrap();

    let args_path = temp.path().join("updater-args");
    let updater_path = current_dir.join("update-native-host.cmd");
    fs::write(
        &updater_path,
        format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}'\nif [ \"$#\" -ne 7 ] || [ \"$1\" != \"-Command\" ] || [ \"$2\" != \"update\" ] || [ \"$3\" != \"-ReleaseTag\" ] || [ \"$4\" != \"v0.2.4\" ] || [ \"$5\" != \"-HostVersion\" ] || [ \"$6\" != \"0.2.4\" ] || [ \"$7\" != \"-Json\" ]; then\n  exit 64\nfi\nprintf '%s\\n' '{{\"command\":\"update\",\"ok\":true,\"previousVersion\":\"0.2.3\",\"installedVersion\":\"0.2.4\",\"helperPath\":\"C:\\\\Users\\\\example\\\\Hover Trans Port\\\\native-hosts\\\\0.2.4\\\\hover-trans-port-helper.exe\"}}'\n",
            args_path.display()
        ),
    )
    .unwrap();
    make_executable(&updater_path);

    fs::write(
        current_dir.join("metadata.json"),
        format!(
            "{{\"hostVersion\":\"0.2.3\",\"protocolVersion\":1,\"source\":\"powershell-script-installer\",\"updaterPath\":\"{}\"}}",
            updater_path.display()
        ),
    )
    .unwrap();

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_INSTALL_ROOT".to_string(),
        install_root.to_string_lossy().into_owned(),
    );
    env.insert(
        "HOVER_TRANS_PORT_TEST_OS".to_string(),
        "windows".to_string(),
    );

    let response = handle_request(
        json!({
            "type":"NATIVE_HOST_UPDATE",
            "requestId":"req-update-windows",
            "targetTag":"v0.2.4",
            "targetVersion":"0.2.4"
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "NATIVE_HOST_UPDATE_RESULT");
    assert_eq!(response["requestId"], "req-update-windows");
    assert_eq!(response["ok"], true);
    assert_eq!(response["previousVersion"], "0.2.3");
    assert_eq!(response["installedVersion"], "0.2.4");
    assert_eq!(
        fs::read_to_string(args_path).unwrap(),
        "-Command\nupdate\n-ReleaseTag\nv0.2.4\n-HostVersion\n0.2.4\n-Json\n"
    );
}

#[test]
fn native_host_update_rejects_path_like_target_version_without_invoking_updater() {
    let temp = tempdir().unwrap();
    let (env, marker_path) = update_fixture_with_marker(temp.path());

    let response = handle_request(
        json!({
            "type":"NATIVE_HOST_UPDATE",
            "requestId":"req-update-invalid-version",
            "targetTag":"v../0.2.3",
            "targetVersion":"../0.2.3"
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "NATIVE_HOST_UPDATE_RESULT");
    assert_eq!(response["requestId"], "req-update-invalid-version");
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"], "INVALID_MESSAGE");
    assert!(!marker_path.exists());
}

#[test]
fn native_host_update_rejects_mismatched_target_tag_without_invoking_updater() {
    for target_tag in ["0.2.3", "v0.2.4"] {
        let temp = tempdir().unwrap();
        let (env, marker_path) = update_fixture_with_marker(temp.path());

        let response = handle_request(
            json!({
                "type":"NATIVE_HOST_UPDATE",
                "requestId":"req-update-invalid-tag",
                "targetTag": target_tag,
                "targetVersion":"0.2.3"
            }),
            BridgeDeps::with_env(env),
        );

        assert_eq!(response["type"], "NATIVE_HOST_UPDATE_RESULT");
        assert_eq!(response["requestId"], "req-update-invalid-tag");
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"], "INVALID_MESSAGE");
        assert!(!marker_path.exists());
    }
}

fn translate_with_provider(
    request_id: &str,
    provider: &str,
    env: BTreeMap<String, String>,
) -> serde_json::Value {
    handle_request(
        json!({
            "type": "TRANSLATE",
            "requestId": request_id,
            "provider": provider,
            "model": "shared-model",
            "targetLang": "Korean",
            "text": "Hello",
            "cacheEnabled": true,
            "timeoutMs": 5_000
        }),
        BridgeDeps::with_env(env),
    )
}

fn subtitle_translate(request_id: &str, env: BTreeMap<String, String>) -> serde_json::Value {
    handle_request(
        json!({
            "type": "TRANSLATE_SUBTITLES",
            "requestId": request_id,
            "provider": "codex",
            "model": "gpt-5.4-mini",
            "targetLang": "Korean",
            "videoId": "abc",
            "sourceTrackIdentity": "track",
            "sourceTimelineHash": "hash",
            "promptVersion": 3,
            "cacheEnabled": true,
            "timeoutMs": 5_000,
            "cues": [
                {
                    "id": "cue-0",
                    "startMs": 0,
                    "endMs": 1000,
                    "text": "Hello"
                }
            ]
        }),
        BridgeDeps::with_env(env),
    )
}

fn fixture_path(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("bin")
        .join(name)
}

fn make_executable(path: &Path) {
    let mut permissions = fs::metadata(path).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).unwrap();
}

fn write_release_fixture(path: &Path, body: &str) {
    fs::write(path, body).unwrap();
}

fn update_fixture_with_marker(temp_path: &Path) -> (BTreeMap<String, String>, PathBuf) {
    let install_root = temp_path.join("Hover Trans Port");
    let current_dir = install_root.join("native-hosts/0.2.3");
    fs::create_dir_all(&current_dir).unwrap();
    symlink(&current_dir, install_root.join("current")).unwrap();

    let marker_path = temp_path.join("updater-invoked");
    let updater_path = current_dir.join("install-macos-native-host.sh");
    fs::write(
        &updater_path,
        format!(
            "#!/bin/sh\nprintf invoked > '{}'\nprintf '%s\n' '{{\"command\":\"update\",\"ok\":true,\"previousVersion\":\"0.2.3\",\"installedVersion\":\"0.2.4\",\"helperPath\":\"/tmp/install/native-hosts/0.2.4/hover-trans-port-helper\"}}'\n",
            marker_path.display()
        ),
    )
    .unwrap();
    make_executable(&updater_path);

    fs::write(
        install_root.join("current").join("metadata.json"),
        format!(
            "{{\"hostVersion\":\"0.2.3\",\"protocolVersion\":2,\"source\":\"macos-script-installer\",\"updaterPath\":\"{}\"}}",
            updater_path.display()
        ),
    )
    .unwrap();

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_INSTALL_ROOT".to_string(),
        install_root.to_string_lossy().into_owned(),
    );

    (env, marker_path)
}
