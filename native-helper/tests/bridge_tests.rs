use hover_trans_port_helper::bridge::{handle_request, BridgeDeps};
use serde_json::json;
use std::collections::BTreeMap;
use std::fs;
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
    assert!(response["bridgeVersion"]
        .as_str()
        .unwrap()
        .starts_with("0.2.0"));
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

    assert_eq!(ids, vec!["codex", "claude", "gemini"]);
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
