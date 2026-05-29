use hover_trans_port_helper::bridge::{handle_request, BridgeDeps};
use hover_trans_port_helper::messages::ProviderId;
use hover_trans_port_helper::providers::antigravity::{
    antigravity_process_timeout_ms, build_antigravity_args, parse_antigravity_output,
    AntigravityProvider,
};
use hover_trans_port_helper::providers::claude::{
    build_claude_args, parse_claude_output, ClaudeProvider,
};
use hover_trans_port_helper::providers::codex::{build_codex_exec_args, CodexProvider};
use hover_trans_port_helper::providers::gemini::{
    build_gemini_args, parse_gemini_output, GeminiProvider,
};
use hover_trans_port_helper::providers::opencode::{
    build_opencode_args, parse_opencode_output, OpencodeProvider,
};
use hover_trans_port_helper::providers::{Provider, ProviderRegistry};
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
fn provider_binary_discovery_finds_windows_cmd_from_path() {
    let temp = tempfile::tempdir().unwrap();
    let bin = temp.path().join("codex.cmd");
    fs::write(&bin, "echo codex\r\n").unwrap();
    make_executable(&bin);
    let mut env = BTreeMap::new();
    env.insert("PATH".to_string(), temp.path().display().to_string());
    env.insert(
        "HOVER_TRANS_PORT_TEST_OS".to_string(),
        "windows".to_string(),
    );

    let found = hover_trans_port_helper::providers::binary_discovery::find_provider_binary(
        &env,
        "HOVER_TRANS_PORT_CODEX_PATH",
        "codex",
    );

    assert_eq!(found, Some(bin));
}

#[test]
fn provider_binary_discovery_prefers_override() {
    let temp = tempfile::tempdir().unwrap();
    let override_path = temp.path().join("custom-codex.exe");
    let path_dir = temp.path().join("path-bin");
    fs::create_dir_all(&path_dir).unwrap();
    let path_candidate = path_dir.join("codex.cmd");
    fs::write(&override_path, "binary").unwrap();
    fs::write(&path_candidate, "echo path codex\r\n").unwrap();
    make_executable(&override_path);
    make_executable(&path_candidate);
    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_CODEX_PATH".to_string(),
        override_path.display().to_string(),
    );
    env.insert("PATH".to_string(), path_dir.display().to_string());
    env.insert(
        "HOVER_TRANS_PORT_TEST_OS".to_string(),
        "windows".to_string(),
    );

    let found = hover_trans_port_helper::providers::binary_discovery::find_provider_binary(
        &env,
        "HOVER_TRANS_PORT_CODEX_PATH",
        "codex",
    );

    assert_eq!(found, Some(override_path));
    assert_ne!(found, Some(path_candidate));
}

#[test]
fn provider_binary_discovery_launch_env_uses_windows_path_separator() {
    let temp = tempfile::tempdir().unwrap();
    let binary = temp.path().join("bin").join("codex.cmd");
    let mut env = BTreeMap::new();
    env.insert("PATH".to_string(), "C\\Tools".to_string());
    env.insert(
        "HOVER_TRANS_PORT_TEST_OS".to_string(),
        "windows".to_string(),
    );

    let launch_env = hover_trans_port_helper::providers::binary_discovery::provider_launch_env(
        &env,
        &binary,
        &[],
    );
    let expected_path = format!("C\\Tools;{}", binary.parent().unwrap().display());

    assert_eq!(
        launch_env.get("PATH").map(String::as_str),
        Some(expected_path.as_str())
    );
}

#[test]
fn provider_binary_discovery_launch_env_preserves_windows_shim_env_keys() {
    let temp = tempfile::tempdir().unwrap();
    let binary = temp.path().join("codex.cmd");
    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_TEST_OS".to_string(),
        "windows".to_string(),
    );
    for key in [
        "APPDATA",
        "LOCALAPPDATA",
        "USERPROFILE",
        "SystemRoot",
        "COMSPEC",
        "PATHEXT",
    ] {
        env.insert(key.to_string(), format!("{key}-value"));
    }

    let launch_env = hover_trans_port_helper::providers::binary_discovery::provider_launch_env(
        &env,
        &binary,
        &[],
    );

    for key in [
        "APPDATA",
        "LOCALAPPDATA",
        "USERPROFILE",
        "SystemRoot",
        "COMSPEC",
        "PATHEXT",
    ] {
        assert_eq!(launch_env.get(key), env.get(key));
    }
}

#[test]
fn provider_binary_discovery_finds_windows_appdata_npm_without_home() {
    let temp = tempfile::tempdir().unwrap();
    let appdata = temp.path().join("AppData").join("Roaming");
    let npm_dir = appdata.join("npm");
    fs::create_dir_all(&npm_dir).unwrap();
    let bin = npm_dir.join("codex.cmd");
    fs::write(&bin, "echo codex\r\n").unwrap();
    make_executable(&bin);
    let mut env = BTreeMap::new();
    env.insert("APPDATA".to_string(), appdata.display().to_string());
    env.insert(
        "HOVER_TRANS_PORT_TEST_OS".to_string(),
        "windows".to_string(),
    );

    let found = hover_trans_port_helper::providers::binary_discovery::find_provider_binary(
        &env,
        "HOVER_TRANS_PORT_CODEX_PATH",
        "codex",
    );

    assert_eq!(found, Some(bin));
}

#[test]
fn provider_binary_discovery_ignores_relative_windows_appdata() {
    let relative_root = relative_tempdir();
    let trap_dir = relative_root.path().join("npm");
    fs::create_dir_all(&trap_dir).unwrap();
    let trap = trap_dir.join("codex.cmd");
    fs::write(&trap, "echo trapped\r\n").unwrap();
    make_executable(&trap);
    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_TEST_OS".to_string(),
        "windows".to_string(),
    );
    env.insert("APPDATA".to_string(), relative_root.relative_path());

    let found = hover_trans_port_helper::providers::binary_discovery::find_provider_binary(
        &env,
        "HOVER_TRANS_PORT_CODEX_PATH",
        "codex",
    );

    assert_eq!(found, None);
}

#[test]
fn provider_binary_discovery_ignores_relative_windows_localappdata() {
    let relative_root = relative_tempdir();
    let trap_dir = relative_root.path().join("pnpm");
    fs::create_dir_all(&trap_dir).unwrap();
    let trap = trap_dir.join("codex.cmd");
    fs::write(&trap, "echo trapped\r\n").unwrap();
    make_executable(&trap);
    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_TEST_OS".to_string(),
        "windows".to_string(),
    );
    env.insert("LOCALAPPDATA".to_string(), relative_root.relative_path());

    let found = hover_trans_port_helper::providers::binary_discovery::find_provider_binary(
        &env,
        "HOVER_TRANS_PORT_CODEX_PATH",
        "codex",
    );

    assert_eq!(found, None);
}

#[test]
fn provider_binary_discovery_ignores_relative_windows_home() {
    let relative_root = relative_tempdir();
    let trap_dir = relative_root.path().join(".local").join("bin");
    fs::create_dir_all(&trap_dir).unwrap();
    let trap = trap_dir.join("codex.cmd");
    fs::write(&trap, "echo trapped\r\n").unwrap();
    make_executable(&trap);
    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_TEST_OS".to_string(),
        "windows".to_string(),
    );
    env.insert("HOME".to_string(), relative_root.relative_path());

    let found = hover_trans_port_helper::providers::binary_discovery::find_provider_binary(
        &env,
        "HOVER_TRANS_PORT_CODEX_PATH",
        "codex",
    );

    assert_eq!(found, None);
}

#[test]
fn provider_binary_discovery_ignores_relative_windows_userprofile() {
    let relative_root = relative_tempdir();
    let trap_dir = relative_root.path().join(".local").join("bin");
    fs::create_dir_all(&trap_dir).unwrap();
    let trap = trap_dir.join("codex.cmd");
    fs::write(&trap, "echo trapped\r\n").unwrap();
    make_executable(&trap);
    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_TEST_OS".to_string(),
        "windows".to_string(),
    );
    env.insert("USERPROFILE".to_string(), relative_root.relative_path());

    let found = hover_trans_port_helper::providers::binary_discovery::find_provider_binary(
        &env,
        "HOVER_TRANS_PORT_CODEX_PATH",
        "codex",
    );

    assert_eq!(found, None);
}

#[test]
fn provider_binary_discovery_preserves_opencode_user_bin() {
    let temp = tempfile::tempdir().unwrap();
    let user_bin = temp.path().join(".opencode").join("bin");
    fs::create_dir_all(&user_bin).unwrap();
    let bin = user_bin.join("opencode");
    fs::write(&bin, "#!/bin/sh\necho opencode\n").unwrap();
    make_executable(&bin);
    let mut env = BTreeMap::new();
    env.insert("HOME".to_string(), temp.path().display().to_string());

    let found = hover_trans_port_helper::providers::binary_discovery::find_provider_binary(
        &env,
        "HOVER_TRANS_PORT_OPENCODE_PATH",
        "opencode",
    );

    assert_eq!(found, Some(bin));
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
fn codex_model_catalog_filters_visible_debug_models() {
    let codex = fixture_path("codex");
    make_executable(&codex);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_CODEX_PATH".to_string(),
        codex.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());

    let provider = CodexProvider::new(env);
    let catalog = provider.model_catalog();

    assert_eq!(catalog.provider, ProviderId::Codex);
    assert_eq!(catalog.default_model, "gpt-5.4-mini");
    assert_eq!(catalog.source, "cli");
    assert!(catalog
        .models
        .iter()
        .any(|model| model.value == "gpt-5.4-mini"));
    assert!(!catalog
        .models
        .iter()
        .any(|model| model.value == "gpt-5.4-nano"));
}

#[test]
fn antigravity_command_builder_uses_print_mode_shape() {
    let args = build_antigravity_args(
        30_000,
        Path::new("/tmp/htp-agy.log"),
        "Translate 'Hello' to Korean.",
    );

    assert_eq!(
        args,
        vec![
            "--log-file",
            "/tmp/htp-agy.log",
            "--print-timeout",
            "30s",
            "--sandbox",
            "--print",
            "Translate 'Hello' to Korean.",
        ]
    );
}

#[test]
fn antigravity_command_builder_rounds_timeout_up_to_seconds() {
    let args = build_antigravity_args(5_500, Path::new("/tmp/htp-agy.log"), "prompt");

    assert_eq!(
        args,
        vec![
            "--log-file",
            "/tmp/htp-agy.log",
            "--print-timeout",
            "6s",
            "--sandbox",
            "--print",
            "prompt",
        ]
    );
}

#[test]
fn antigravity_process_timeout_allows_print_timeout_grace() {
    assert_eq!(antigravity_process_timeout_ms(5_500), 6_500);
    assert_eq!(antigravity_process_timeout_ms(5_000), 5_500);
    assert_eq!(antigravity_process_timeout_ms(0), 1_500);
}

#[test]
fn antigravity_model_catalog_uses_default_only_shape() {
    let provider = AntigravityProvider::new(BTreeMap::new());
    let catalog = provider.model_catalog();

    assert_eq!(catalog.provider, ProviderId::Antigravity);
    assert_eq!(catalog.default_model, "");
    assert!(!catalog.supports_custom_model);
    assert_eq!(catalog.models.len(), 1);
    assert_eq!(catalog.models[0].value, "");
    assert_eq!(catalog.models[0].label, "Default (Antigravity CLI)");
}

#[test]
fn antigravity_output_parser_returns_plain_text() {
    assert_eq!(
        parse_antigravity_output("안녕하세요\n").unwrap(),
        "안녕하세요"
    );
}

#[test]
fn antigravity_output_parser_rejects_empty_stdout() {
    let error = parse_antigravity_output(" \n").unwrap_err();

    assert_eq!(error.code(), "PROVIDER_OUTPUT_PARSE_FAILED");
}

#[test]
fn antigravity_fake_cli_translation_returns_success_result() {
    let agy = fixture_path("agy");
    make_executable(&agy);
    let home_dir = tempdir().unwrap();
    let workspace_dir = home_dir.path().join("agy-workspace");

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_ANTIGRAVITY_PATH".to_string(),
        agy.to_string_lossy().into_owned(),
    );
    env.insert(
        "HOVER_TRANS_PORT_ANTIGRAVITY_WORKSPACE_DIR".to_string(),
        workspace_dir.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    env.insert("HOME".to_string(), home_dir.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "TRANSLATE",
            "requestId": "req-antigravity",
            "provider": "antigravity",
            "model": "ignored-by-provider",
            "targetLang": "Korean",
            "text": "Hello",
            "cacheEnabled": false,
            "timeoutMs": 5_000
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "TRANSLATE_RESULT");
    assert_eq!(response["requestId"], "req-antigravity");
    assert_eq!(response["ok"], true);
    assert_eq!(response["provider"], "antigravity");
    assert_eq!(response["translatedText"], "안티그래비티 안녕하세요");
    assert_eq!(response["cached"], false);
    assert!(workspace_dir.join(".antigravitycli").is_dir());
    let recorded_cwd = fs::read_to_string(home_dir.path().join("agy-cwd.txt")).unwrap();
    assert_eq!(
        fs::canonicalize(recorded_cwd.trim_end()).unwrap(),
        fs::canonicalize(&workspace_dir).unwrap()
    );
}

#[test]
fn antigravity_nonzero_error_surfaces_stderr_message() {
    let agy = fixture_path("agy");
    make_executable(&agy);
    let home_dir = tempdir().unwrap();

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_ANTIGRAVITY_PATH".to_string(),
        agy.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    env.insert("HOME".to_string(), home_dir.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "TRANSLATE",
            "requestId": "req-antigravity-auth",
            "provider": "antigravity",
            "model": "",
            "targetLang": "Korean",
            "text": "Trigger auth error",
            "cacheEnabled": false,
            "timeoutMs": 5_000
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "TRANSLATE_RESULT");
    assert_eq!(response["requestId"], "req-antigravity-auth");
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"], "PROVIDER_EXIT_NONZERO");
    assert!(response["message"]
        .as_str()
        .unwrap()
        .contains("You are not logged into Antigravity"));
}

#[test]
fn claude_model_catalog_uses_unified_fallback_shape() {
    let provider = ClaudeProvider::new(BTreeMap::new());
    let catalog = provider.model_catalog();

    assert_eq!(catalog.provider, ProviderId::Claude);
    assert_eq!(catalog.default_model, "haiku");
    assert!(catalog.supports_custom_model);
    assert!(catalog.models.iter().any(|model| model.value == "default"));
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
fn claude_nonzero_json_error_surfaces_result_message() {
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
            "requestId": "req-claude-auth",
            "provider": "claude",
            "model": "",
            "targetLang": "Korean",
            "text": "Trigger auth error",
            "cacheEnabled": false,
            "timeoutMs": 5_000
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "TRANSLATE_RESULT");
    assert_eq!(response["requestId"], "req-claude-auth");
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"], "PROVIDER_EXIT_NONZERO");
    assert!(response["message"]
        .as_str()
        .unwrap()
        .contains("Not logged in"));
}

#[test]
fn claude_provider_status_finds_home_local_bin_when_path_is_minimal() {
    let fixture = fixture_path("claude");
    let home_dir = tempdir().unwrap();
    let local_bin = home_dir.path().join(".local").join("bin");
    fs::create_dir_all(&local_bin).unwrap();
    let claude = local_bin.join("claude");
    fs::copy(&fixture, &claude).unwrap();
    make_executable(&claude);

    let mut env = BTreeMap::new();
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    env.insert("HOME".to_string(), home_dir.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "PROVIDER_STATUS",
            "requestId": "req-providers"
        }),
        BridgeDeps::with_env(env),
    );

    let providers = response["providers"].as_array().unwrap();
    let claude_status = providers
        .iter()
        .find(|provider| provider["id"] == "claude")
        .unwrap();

    assert_eq!(claude_status["available"], true);
    assert_eq!(claude_status["binaryPath"], claude.display().to_string());
    assert_eq!(claude_status["version"], "claude test-version");
}

#[test]
fn claude_command_builder_uses_subscription_auth_compatible_json_shape() {
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
fn claude_command_builder_omits_default_model_sentinel() {
    let args = build_claude_args(Some("default"));

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
fn claude_provider_defaults_to_haiku_alias() {
    let provider = ClaudeProvider::new(BTreeMap::new());

    assert_eq!(provider.default_model(), "haiku");
}

#[test]
fn provider_registry_resolves_selected_provider_ids() {
    let registry = ProviderRegistry::new(BTreeMap::new());

    assert_eq!(
        registry.provider_id_for_selection(Some("opencode")),
        ProviderId::Opencode
    );
    assert_eq!(
        registry.provider_id_for_selection(Some("gemini")),
        ProviderId::Gemini
    );
    assert_eq!(
        registry.provider_id_for_selection(Some("claude")),
        ProviderId::Claude
    );
    assert_eq!(
        registry.provider_id_for_selection(Some("codex")),
        ProviderId::Codex
    );
    assert_eq!(
        registry.provider_id_for_selection(Some("antigravity")),
        ProviderId::Antigravity
    );
    assert_eq!(
        registry.provider_id_for_selection(Some("auto")),
        ProviderId::Codex
    );
    assert_eq!(registry.provider_id_for_selection(None), ProviderId::Codex);
}

#[test]
fn antigravity_status_reports_binary_without_executing_it() {
    let temp = tempdir().unwrap();
    let agy = temp.path().join("agy");
    let marker = temp.path().join("agy-ran");
    fs::write(
        &agy,
        format!("#!/bin/sh\ntouch '{}'\nexit 42\n", marker.display()),
    )
    .unwrap();
    make_executable(&agy);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_ANTIGRAVITY_PATH".to_string(),
        agy.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());

    let status = AntigravityProvider::new(env).status();

    assert_eq!(status.id, ProviderId::Antigravity);
    assert_eq!(status.available, true);
    assert_eq!(status.binary_path, Some(agy.display().to_string()));
    assert_eq!(status.version, None);
    assert_eq!(status.error, None);
    assert!(
        !marker.exists(),
        "Antigravity status check should not execute agy"
    );
}

#[test]
fn claude_json_output_parser_returns_result() {
    let output = r#"{"type":"result","subtype":"success","is_error":false,"result":"번역 결과"}"#;

    assert_eq!(parse_claude_output(output).unwrap(), "번역 결과");
}

#[test]
fn claude_json_output_parser_treats_is_error_as_provider_error() {
    let output = r#"{"type":"result","subtype":"error","is_error":true,"result":"not logged in"}"#;

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
            "--extensions",
            "none",
            "--model",
            "gemini-2.5-pro",
        ]
    );
}

#[test]
fn gemini_command_builder_omits_default_model_sentinel() {
    let args = build_gemini_args(Some("default"));

    assert_eq!(
        args,
        vec![
            "-p",
            "Translate according to the instructions provided on stdin. Return only the translated text.",
            "--output-format",
            "json",
            "--extensions",
            "none",
        ]
    );
}

#[test]
fn gemini_model_catalog_uses_unified_fallback_shape() {
    let provider = GeminiProvider::new(BTreeMap::new());
    let catalog = provider.model_catalog();

    assert_eq!(catalog.provider, ProviderId::Gemini);
    assert_eq!(catalog.default_model, "");
    assert!(catalog.supports_custom_model);
    assert!(catalog.models.iter().any(|model| model.value == ""));
    assert!(catalog
        .models
        .iter()
        .any(|model| model.value == "gemini-2.5-flash"));
}

#[test]
fn gemini_fake_cli_translation_returns_success_result() {
    let gemini = fixture_path("gemini");
    make_executable(&gemini);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_GEMINI_PATH".to_string(),
        gemini.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    let home_dir = tempdir().unwrap();
    env.insert("HOME".to_string(), home_dir.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "TRANSLATE",
            "requestId": "req-gemini",
            "provider": "gemini",
            "model": "",
            "targetLang": "Korean",
            "text": "Hello",
            "cacheEnabled": false,
            "timeoutMs": 5_000
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "TRANSLATE_RESULT");
    assert_eq!(response["requestId"], "req-gemini");
    assert_eq!(response["ok"], true);
    assert_eq!(response["provider"], "gemini");
    assert_eq!(response["translatedText"], "제미나이 안녕하세요");
    assert_eq!(response["cached"], false);
}

#[test]
fn gemini_nonzero_json_error_surfaces_error_message() {
    let gemini = fixture_path("gemini");
    make_executable(&gemini);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_GEMINI_PATH".to_string(),
        gemini.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    let home_dir = tempdir().unwrap();
    env.insert("HOME".to_string(), home_dir.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "TRANSLATE",
            "requestId": "req-gemini-auth",
            "provider": "gemini",
            "model": "",
            "targetLang": "Korean",
            "text": "Trigger auth error",
            "cacheEnabled": false,
            "timeoutMs": 5_000
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "TRANSLATE_RESULT");
    assert_eq!(response["requestId"], "req-gemini-auth");
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"], "PROVIDER_EXIT_NONZERO");
    assert!(response["message"]
        .as_str()
        .unwrap()
        .contains("Not logged in"));
}

#[test]
fn gemini_output_parser_accepts_json_result_and_plain_text() {
    assert_eq!(
        parse_gemini_output(r#"{"response":"번역 결과"}"#).unwrap(),
        "번역 결과"
    );
    assert_eq!(
        parse_gemini_output(r#"{"result":"번역 결과"}"#).unwrap(),
        "번역 결과"
    );
    assert_eq!(
        parse_gemini_output("plain translated text").unwrap(),
        "plain translated text"
    );
}

#[test]
fn opencode_command_builder_uses_default_model_when_model_is_empty() {
    let args = build_opencode_args(Some("  "), Path::new("/tmp/htp"));

    assert_eq!(
        args,
        vec![
            "run",
            "--format",
            "json",
            "--pure",
            "--dir",
            "/tmp/htp",
            "--agent",
            "build",
            "--title",
            "HoverTransPort translation",
        ]
    );
}

#[test]
fn opencode_command_builder_pins_primary_agent() {
    let args = build_opencode_args(None, Path::new("/tmp/htp"));

    let agent_flag = args.iter().position(|arg| arg == "--agent").unwrap();

    assert_eq!(args.get(agent_flag + 1).map(String::as_str), Some("build"));
}

#[test]
fn opencode_command_builder_keeps_prompt_text_out_of_argv() {
    let args = build_opencode_args(Some("  "), Path::new("/tmp/htp"));

    assert!(!args.iter().any(|arg| arg == "--file"));
    assert!(!args.iter().any(|arg| arg.contains("secret source text")));
}

#[test]
fn opencode_command_builder_passes_explicit_model() {
    let args = build_opencode_args(Some("opencode/gpt-5"), Path::new("/tmp/htp"));

    assert_eq!(
        args,
        vec![
            "run",
            "--format",
            "json",
            "--pure",
            "--dir",
            "/tmp/htp",
            "--model",
            "opencode/gpt-5",
            "--agent",
            "build",
            "--title",
            "HoverTransPort translation",
        ]
    );
}

#[test]
fn opencode_model_catalog_uses_default_cli_model() {
    let provider = OpencodeProvider::new(BTreeMap::new());
    let catalog = provider.model_catalog();

    assert_eq!(catalog.provider, ProviderId::Opencode);
    assert_eq!(catalog.default_model, "");
    assert!(catalog.supports_custom_model);
    assert_eq!(catalog.models.len(), 1);
    assert_eq!(catalog.models[0].value, "");
    assert_eq!(catalog.models[0].label, "Default (OpenCode CLI)");
    assert_eq!(catalog.models[0].recommended, Some(true));
}

#[test]
fn opencode_fake_cli_translation_returns_success_result() {
    let opencode = fixture_path("opencode");
    make_executable(&opencode);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_OPENCODE_PATH".to_string(),
        opencode.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    let home_dir = tempdir().unwrap();
    env.insert("HOME".to_string(), home_dir.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "TRANSLATE",
            "requestId": "req-opencode",
            "provider": "opencode",
            "model": "",
            "targetLang": "Korean",
            "text": "Hello",
            "cacheEnabled": false,
            "timeoutMs": 5_000
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "TRANSLATE_RESULT");
    assert_eq!(response["requestId"], "req-opencode");
    assert_eq!(response["ok"], true);
    assert_eq!(response["provider"], "opencode");
    assert_eq!(response["translatedText"], "오픈코드 안녕하세요");
    assert_eq!(response["cached"], false);
}

#[test]
fn opencode_fake_cli_translation_enforces_safe_permission_env() {
    let opencode = fixture_path("opencode");
    make_executable(&opencode);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_OPENCODE_PATH".to_string(),
        opencode.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    let home_dir = tempdir().unwrap();
    env.insert("HOME".to_string(), home_dir.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "TRANSLATE",
            "requestId": "req-opencode-safe-env",
            "provider": "opencode",
            "model": "",
            "targetLang": "Korean",
            "text": "Assert safe OpenCode env",
            "cacheEnabled": false,
            "timeoutMs": 5_000
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "TRANSLATE_RESULT");
    assert_eq!(response["requestId"], "req-opencode-safe-env");
    assert_eq!(response["ok"], true);
    assert_eq!(response["provider"], "opencode");
    assert_eq!(response["translatedText"], "안전한 오픈코드 환경");
}

#[test]
fn opencode_nonzero_json_error_surfaces_error_message() {
    let opencode = fixture_path("opencode");
    make_executable(&opencode);

    let mut env = BTreeMap::new();
    env.insert(
        "HOVER_TRANS_PORT_OPENCODE_PATH".to_string(),
        opencode.to_string_lossy().into_owned(),
    );
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());
    let home_dir = tempdir().unwrap();
    env.insert("HOME".to_string(), home_dir.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "TRANSLATE",
            "requestId": "req-opencode-auth",
            "provider": "opencode",
            "model": "",
            "targetLang": "Korean",
            "text": "Trigger auth error",
            "cacheEnabled": false,
            "timeoutMs": 5_000
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "TRANSLATE_RESULT");
    assert_eq!(response["requestId"], "req-opencode-auth");
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"], "PROVIDER_EXIT_NONZERO");
    assert!(response["message"]
        .as_str()
        .unwrap()
        .contains("Not logged in"));
}

#[test]
fn opencode_output_parser_accepts_json_event_and_plain_text() {
    assert_eq!(
        parse_opencode_output(
            r#"{"type":"message","message":{"content":[{"type":"text","text":"번역 결과"}]}}"#
        )
        .unwrap(),
        "번역 결과"
    );
    assert_eq!(
        parse_opencode_output(
            r#"{"type":"message","error":null,"message":{"content":[{"type":"text","text":"번역 결과"}]}}"#
        )
        .unwrap(),
        "번역 결과"
    );
    assert_eq!(
        parse_opencode_output("plain translated text").unwrap(),
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

struct RelativeTempDir {
    _dir: tempfile::TempDir,
    relative_path: String,
}

impl RelativeTempDir {
    fn path(&self) -> &Path {
        Path::new(&self.relative_path)
    }

    fn relative_path(&self) -> String {
        self.relative_path.clone()
    }
}

fn relative_tempdir() -> RelativeTempDir {
    let dir = tempfile::Builder::new()
        .prefix(".provider-discovery-")
        .tempdir_in(std::env::current_dir().unwrap())
        .unwrap();
    let relative_path = dir
        .path()
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();

    RelativeTempDir {
        _dir: dir,
        relative_path,
    }
}

fn make_executable(path: &Path) {
    let mut permissions = fs::metadata(path).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).unwrap();
}
