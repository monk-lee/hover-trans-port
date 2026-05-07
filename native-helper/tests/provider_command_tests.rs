use hover_trans_port_helper::bridge::{handle_request, BridgeDeps};
use hover_trans_port_helper::providers::claude::{build_claude_args, parse_claude_output};
use hover_trans_port_helper::providers::codex::build_codex_exec_args;
use hover_trans_port_helper::providers::gemini::{build_gemini_args, parse_gemini_output};
use serde_json::json;
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use tempfile::tempdir;

#[test]
fn codex_command_builder_matches_node_provider_shape() {
    let args = build_codex_exec_args(
        "gpt-5.4-mini",
        Path::new("/tmp/htp"),
        Path::new("/tmp/htp/last-message.txt"),
    );

    assert_eq!(
        args,
        vec![
            "exec",
            "--model",
            "gpt-5.4-mini",
            "--ephemeral",
            "--sandbox",
            "read-only",
            "--ignore-rules",
            "--ignore-user-config",
            "--skip-git-repo-check",
            "-C",
            "/tmp/htp",
            "--output-last-message",
            "/tmp/htp/last-message.txt",
            "-"
        ]
    );
}

#[test]
fn codex_fake_cli_translation_returns_success_result() {
    let codex = fixture_path("codex");
    make_executable(&codex);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_CODEX_PATH".to_string(),
        codex.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    env.insert(
        "HOME".to_string(),
        tempdir().unwrap().path().display().to_string(),
    );

    let response = handle_request(
        json!({
            "type": "TRANSLATE",
            "requestId": "req-codex",
            "provider": "codex",
            "model": "gpt-5.4-mini",
            "targetLang": "Korean",
            "text": "Hello",
            "cacheEnabled": false,
            "timeoutMs": 5_000
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "TRANSLATE_RESULT");
    assert_eq!(response["requestId"], "req-codex");
    assert_eq!(response["ok"], true);
    assert_eq!(response["provider"], "codex");
    assert_eq!(response["translatedText"], "안녕하세요");
    assert_eq!(response["cached"], false);
}

#[test]
fn claude_fake_cli_translation_returns_success_result() {
    let claude = fixture_path("claude");
    make_executable(&claude);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_CLAUDE_PATH".to_string(),
        claude.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    let home_dir = tempdir().unwrap();
    env.insert("HOME".to_string(), home_dir.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "TRANSLATE",
            "requestId": "req-claude",
            "provider": "claude",
            "model": "",
            "targetLang": "Korean",
            "text": "Hello",
            "cacheEnabled": false,
            "timeoutMs": 5_000
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "TRANSLATE_RESULT");
    assert_eq!(response["requestId"], "req-claude");
    assert_eq!(response["ok"], true);
    assert_eq!(response["provider"], "claude");
    assert_eq!(response["translatedText"], "클로드 안녕하세요");
    assert_eq!(response["cached"], false);
}

#[test]
fn claude_command_builder_uses_constrained_headless_json_shape() {
    let args = build_claude_args(Some("claude-sonnet-4"));

    assert_eq!(
        args,
        vec![
            "-p",
            "Translate according to the instructions provided on stdin. Return only the translated text.",
            "--output-format",
            "json",
            "--no-session-persistence",
            "--tools",
            "",
            "--model",
            "claude-sonnet-4",
        ]
    );
}

#[test]
fn claude_command_builder_omits_empty_model() {
    let args = build_claude_args(Some("  "));

    assert_eq!(
        args,
        vec![
            "-p",
            "Translate according to the instructions provided on stdin. Return only the translated text.",
            "--output-format",
            "json",
            "--no-session-persistence",
            "--tools",
            "",
        ]
    );
}

#[test]
fn claude_json_output_parser_returns_result() {
    let output = r#"{"type":"result","subtype":"success","is_error":false,"result":"번역 결과"}"#;

    assert_eq!(parse_claude_output(output).unwrap(), "번역 결과");
}

#[test]
fn claude_json_output_parser_treats_is_error_as_provider_error() {
    let output =
        r#"{"type":"result","subtype":"error","is_error":true,"result":"not logged in"}"#;

    let error = parse_claude_output(output).unwrap_err();

    assert_eq!(error.code(), "PROVIDER_EXIT_NONZERO");
    assert!(error.to_string().contains("not logged in"));
}

#[test]
fn gemini_command_builder_uses_non_interactive_json_shape() {
    let args = build_gemini_args(Some("gemini-2.5-pro"));

    assert_eq!(
        args,
        vec![
            "-p",
            "Translate according to the instructions provided on stdin. Return only the translated text.",
            "--output-format",
            "json",
            "--model",
            "gemini-2.5-pro",
        ]
    );
}

#[test]
fn gemini_output_parser_accepts_json_result_and_plain_text() {
    assert_eq!(
        parse_gemini_output(r#"{"result":"번역 결과"}"#).unwrap(),
        "번역 결과"
    );
    assert_eq!(
        parse_gemini_output("plain translated text").unwrap(),
        "plain translated text"
    );
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
