use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use tempfile::tempdir;

use crate::messages::{ProviderId, ProviderStatusEntry};
use crate::process::{run_process, ProcessRequest, ProviderError};
use crate::prompt::build_translate_prompt;
use crate::providers::executable::{
    build_provider_env, command_candidates, env_value, find_binary,
};
use crate::providers::{
    Provider, ProviderModelCatalog, ProviderModelOption, ProviderTranslateRequest,
    ProviderTranslateResult,
};

const DEFAULT_CODEX_MODEL: &str = "gpt-5.4-mini";
const DEFAULT_STATUS_TIMEOUT_MS: u64 = 5_000;
const UNSUPPORTED_CODEX_MODELS: &[&str] = &["gpt-5.4-nano"];

#[derive(Clone, Debug)]
pub struct CodexProvider {
    env: BTreeMap<String, String>,
}

impl CodexProvider {
    pub fn new(env: BTreeMap<String, String>) -> Self {
        Self { env }
    }

    fn find_binary(&self) -> Option<PathBuf> {
        find_codex_binary(&self.env)
    }
}

impl Provider for CodexProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Codex
    }

    fn label(&self) -> &'static str {
        "Codex CLI"
    }

    fn default_model(&self) -> &'static str {
        DEFAULT_CODEX_MODEL
    }

    fn status(&self) -> ProviderStatusEntry {
        let Some(binary) = self.find_binary() else {
            return ProviderStatusEntry {
                id: self.id(),
                available: false,
                binary_path: None,
                version: None,
                error: Some("PROVIDER_NOT_FOUND".to_string()),
            };
        };

        match run_process(ProcessRequest {
            executable: binary.clone(),
            args: vec!["--version".to_string()],
            cwd: None,
            env: provider_env(&self.env, &binary),
            stdin: String::new(),
            timeout_ms: DEFAULT_STATUS_TIMEOUT_MS,
        }) {
            Ok(output) => ProviderStatusEntry {
                id: self.id(),
                available: true,
                binary_path: Some(binary.display().to_string()),
                version: Some(compact_version(&output.stdout)),
                error: None,
            },
            Err(error) => ProviderStatusEntry {
                id: self.id(),
                available: false,
                binary_path: Some(binary.display().to_string()),
                version: None,
                error: Some(error.code().to_string()),
            },
        }
    }

    fn model_catalog(&self) -> ProviderModelCatalog {
        let Some(binary) = self.find_binary() else {
            return codex_fallback_model_catalog();
        };

        let output = run_process(ProcessRequest {
            executable: binary.clone(),
            args: vec!["debug".to_string(), "models".to_string()],
            cwd: None,
            env: provider_env(&self.env, &binary),
            stdin: String::new(),
            timeout_ms: DEFAULT_STATUS_TIMEOUT_MS,
        });

        output
            .ok()
            .and_then(|output| parse_codex_model_catalog(&output.stdout).ok())
            .unwrap_or_else(codex_fallback_model_catalog)
    }

    fn translate(
        &self,
        request: ProviderTranslateRequest,
    ) -> Result<ProviderTranslateResult, ProviderError> {
        let Some(binary) = self.find_binary() else {
            return Err(ProviderError::NotFound {
                executable: PathBuf::from("codex"),
            });
        };

        let temp_dir = tempdir().map_err(|error| ProviderError::SpawnFailed {
            message: error.to_string(),
        })?;
        let output_file = temp_dir.path().join("last-message.txt");
        let model = resolve_codex_model(&self.env, request.model.as_deref(), self.default_model());
        let prompt =
            build_translate_prompt(&request.text, &request.source_lang, &request.target_lang);
        let output = run_process(ProcessRequest {
            executable: binary.clone(),
            args: build_codex_exec_args(&model, temp_dir.path(), &output_file),
            cwd: Some(temp_dir.path().to_path_buf()),
            env: provider_env(&self.env, &binary),
            stdin: prompt,
            timeout_ms: request.timeout_ms,
        })?;

        let last_message = fs::read_to_string(&output_file).unwrap_or_default();
        let translated_text = parse_codex_output(&last_message, &output.stdout)?;

        Ok(ProviderTranslateResult {
            translated_text,
            elapsed_ms: output.elapsed_ms,
        })
    }
}

fn codex_fallback_model_catalog() -> ProviderModelCatalog {
    ProviderModelCatalog {
        provider: ProviderId::Codex,
        default_model: DEFAULT_CODEX_MODEL.to_string(),
        models: vec![
            ProviderModelOption {
                value: "gpt-5.5".to_string(),
                label: "GPT-5.5".to_string(),
                recommended: None,
            },
            ProviderModelOption {
                value: "gpt-5.4".to_string(),
                label: "GPT-5.4".to_string(),
                recommended: None,
            },
            ProviderModelOption {
                value: "gpt-5.4-mini".to_string(),
                label: "GPT-5.4 Mini".to_string(),
                recommended: Some(true),
            },
            ProviderModelOption {
                value: "gpt-5.3-codex".to_string(),
                label: "GPT-5.3 Codex".to_string(),
                recommended: None,
            },
            ProviderModelOption {
                value: "gpt-5.3-codex-spark".to_string(),
                label: "GPT-5.3 Codex Spark".to_string(),
                recommended: None,
            },
            ProviderModelOption {
                value: "gpt-5.2".to_string(),
                label: "GPT-5.2".to_string(),
                recommended: None,
            },
        ],
        supports_custom_model: true,
        source: "fallback".to_string(),
    }
}

fn parse_codex_model_catalog(stdout: &str) -> Result<ProviderModelCatalog, ProviderError> {
    let mut search_start = 0;

    while search_start < stdout.len() {
        let Some(relative_start) = stdout[search_start..].find('{') else {
            break;
        };
        let start = search_start + relative_start;
        search_start = start + 1;

        let Some(json_text) = extract_json_object_at(stdout, start) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(json_text) else {
            continue;
        };

        if let Some(catalog) = codex_model_catalog_from_value(&value) {
            return Ok(catalog);
        }
    }

    Err(ProviderError::OutputParseFailed {
        message: "Codex model catalog output did not contain model JSON.".to_string(),
    })
}

fn codex_model_catalog_from_value(value: &serde_json::Value) -> Option<ProviderModelCatalog> {
    let Some(model_values) = value.get("models").and_then(serde_json::Value::as_array) else {
        return None;
    };

    let models = model_values
        .iter()
        .filter(|model| model["visibility"].as_str() == Some("list"))
        .filter_map(|model| {
            let value = model["slug"].as_str()?.to_string();
            let label = model["display_name"]
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| value.clone());
            Some(ProviderModelOption {
                recommended: (value == DEFAULT_CODEX_MODEL).then_some(true),
                value,
                label,
            })
        })
        .filter(|model| !UNSUPPORTED_CODEX_MODELS.contains(&model.value.as_str()))
        .collect::<Vec<_>>();

    if models.is_empty() {
        return None;
    }

    Some(ProviderModelCatalog {
        provider: ProviderId::Codex,
        default_model: DEFAULT_CODEX_MODEL.to_string(),
        models,
        supports_custom_model: true,
        source: "cli".to_string(),
    })
}

fn extract_json_object_at(text: &str, start: usize) -> Option<&str> {
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (offset, char) in text[start..].char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if char == '\\' {
                escaped = true;
            } else if char == '"' {
                in_string = false;
            }
            continue;
        }

        if char == '"' {
            in_string = true;
        } else if char == '{' {
            depth += 1;
        } else if char == '}' {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                let end = start + offset + char.len_utf8();
                return Some(&text[start..end]);
            }
        }
    }

    None
}

pub fn build_codex_exec_args(model: &str, temp_dir: &Path, output_file: &Path) -> Vec<String> {
    vec![
        "exec".to_string(),
        "--model".to_string(),
        model.to_string(),
        "--ephemeral".to_string(),
        "--sandbox".to_string(),
        "read-only".to_string(),
        "--ignore-rules".to_string(),
        "--ignore-user-config".to_string(),
        "--skip-git-repo-check".to_string(),
        "-C".to_string(),
        temp_dir.display().to_string(),
        "--output-last-message".to_string(),
        output_file.display().to_string(),
        "-".to_string(),
    ]
}

fn find_codex_binary(env: &BTreeMap<String, String>) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(install_dir) = env_value(env, "CODEX_INSTALL_DIR") {
        candidates.push(Path::new(install_dir).join("codex.exe"));
    }
    if let Some(local_app_data) = env_value(env, "LOCALAPPDATA") {
        candidates.push(
            Path::new(local_app_data)
                .join("Programs")
                .join("OpenAI")
                .join("Codex")
                .join("bin")
                .join("codex.exe"),
        );
    }
    if let Some(codex_home) = env_value(env, "CODEX_HOME") {
        candidates.push(
            Path::new(codex_home)
                .join("packages")
                .join("standalone")
                .join("current")
                .join("bin")
                .join("codex.exe"),
        );
    }
    if let Some(user_profile) = env_value(env, "USERPROFILE") {
        candidates.push(
            Path::new(user_profile)
                .join(".codex")
                .join("packages")
                .join("standalone")
                .join("current")
                .join("bin")
                .join("codex.exe"),
        );
    }
    candidates.extend(command_candidates(env, "codex"));
    if let Some(app_data) = env_value(env, "APPDATA") {
        let npm_dir = Path::new(app_data).join("npm");
        candidates.push(npm_dir.join("codex.cmd"));
        candidates.push(npm_dir.join("codex.ps1"));
        candidates.push(npm_dir.join("codex.exe"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/codex"));
    candidates.push(PathBuf::from("/usr/local/bin/codex"));
    candidates.push(PathBuf::from("/usr/bin/codex"));

    find_binary(env, "HOVER_TRANS_PORT_CODEX_PATH", candidates)
}

fn provider_env(env: &BTreeMap<String, String>, binary: &Path) -> BTreeMap<String, String> {
    build_provider_env(
        env,
        binary,
        &[
            "HOME",
            "CODEX_HOME",
            "CODEX_INSTALL_DIR",
            "PATH",
            "TMPDIR",
            "USER",
            "LANG",
            "LC_ALL",
            "USERPROFILE",
            "APPDATA",
            "LOCALAPPDATA",
            "SystemRoot",
            "ComSpec",
            "PATHEXT",
            "TEMP",
            "TMP",
        ],
    )
}

fn compact_version(stdout: &str) -> String {
    stdout.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn resolve_codex_model(
    env: &BTreeMap<String, String>,
    requested: Option<&str>,
    fallback: &str,
) -> String {
    let selected = env
        .get("HOVER_TRANS_PORT_CODEX_MODEL")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .or_else(|| requested.map(str::trim).filter(|value| !value.is_empty()));

    match selected {
        Some(model) if !UNSUPPORTED_CODEX_MODELS.contains(&model) => model.to_string(),
        _ => fallback.to_string(),
    }
}

fn parse_codex_output(last_message: &str, stdout: &str) -> Result<String, ProviderError> {
    let candidate = if !last_message.trim().is_empty() {
        last_message.trim().to_string()
    } else if let Some(jsonl_text) = extract_jsonl_text(stdout) {
        jsonl_text
    } else {
        stdout.trim().to_string()
    };
    let parsed = strip_markdown_fence(candidate.replace("\r\n", "\n").trim());

    if parsed.is_empty() {
        return Err(ProviderError::OutputParseFailed {
            message: "Codex output was empty.".to_string(),
        });
    }

    if parsed
        .to_lowercase()
        .starts_with("translate the following text to korean.")
    {
        return Err(ProviderError::OutputParseFailed {
            message: "Codex output echoed the prompt.".to_string(),
        });
    }

    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    use tempfile::tempdir;

    #[test]
    fn resolve_codex_model_maps_unsupported_nano_to_default() {
        let env = BTreeMap::new();

        assert_eq!(
            resolve_codex_model(&env, Some("gpt-5.4-nano"), DEFAULT_CODEX_MODEL),
            DEFAULT_CODEX_MODEL
        );
    }

    #[test]
    fn find_codex_binary_finds_windows_path_env_with_cmd_extension() {
        let temp = tempdir().unwrap();
        let first_bin = temp.path().join("first");
        let second_bin = temp.path().join("second");
        fs::create_dir_all(&first_bin).unwrap();
        fs::create_dir_all(&second_bin).unwrap();
        let codex = second_bin.join("codex.cmd");
        write_test_executable(&codex);

        let mut env = BTreeMap::new();
        env.insert(
            "Path".to_string(),
            format!("{};{}", first_bin.display(), second_bin.display()),
        );
        env.insert(
            "PATHEXT".to_string(),
            ".COM;.EXE;.CMD;.BAT;.PS1".to_string(),
        );

        assert_eq!(find_codex_binary(&env), Some(codex));
    }

    #[test]
    #[cfg(not(windows))]
    fn find_codex_binary_preserves_unix_path_lookup() {
        let temp = tempdir().unwrap();
        let first_bin = temp.path().join("first");
        let second_bin = temp.path().join("second");
        fs::create_dir_all(&first_bin).unwrap();
        fs::create_dir_all(&second_bin).unwrap();
        let codex = second_bin.join("codex");
        write_test_executable(&codex);

        let mut env = BTreeMap::new();
        env.insert(
            "PATH".to_string(),
            format!("{}:{}", first_bin.display(), second_bin.display()),
        );

        assert_eq!(find_codex_binary(&env), Some(codex));
    }

    #[test]
    #[cfg(windows)]
    fn codex_status_executes_windows_npm_cmd_shim() {
        let temp = tempdir().unwrap();
        let app_data = temp.path().join("AppData").join("Roaming");
        let codex = app_data.join("npm").join("codex.cmd");
        fs::create_dir_all(codex.parent().unwrap()).unwrap();
        fs::write(&codex, "@echo off\r\necho codex cmd-test-version\r\n").unwrap();

        let mut env = BTreeMap::new();
        env.insert("APPDATA".to_string(), app_data.display().to_string());
        copy_process_env_if_present(&mut env, "Path");
        copy_process_env_if_present(&mut env, "PATH");
        copy_process_env_if_present(&mut env, "PATHEXT");
        copy_process_env_if_present(&mut env, "SystemRoot");
        copy_process_env_if_present(&mut env, "ComSpec");
        copy_process_env_if_present(&mut env, "TEMP");
        copy_process_env_if_present(&mut env, "TMP");
        env.entry("Path".to_string())
            .or_insert_with(|| "C:\\Windows\\System32".to_string());
        env.entry("PATHEXT".to_string())
            .or_insert_with(|| ".COM;.EXE;.CMD;.BAT;.PS1".to_string());
        env.entry("SystemRoot".to_string())
            .or_insert_with(|| "C:\\Windows".to_string());
        env.entry("ComSpec".to_string())
            .or_insert_with(|| "C:\\Windows\\System32\\cmd.exe".to_string());

        let status = CodexProvider::new(env).status();

        assert_eq!(status.available, true, "{status:?}");
        assert_eq!(status.binary_path, Some(codex.display().to_string()));
        assert_eq!(status.version, Some("codex cmd-test-version".to_string()));
    }

    #[test]
    fn find_codex_binary_prefers_codex_install_dir_before_local_app_data() {
        let temp = tempdir().unwrap();
        let install_dir = temp.path().join("CodexInstallDir");
        let install_codex = install_dir.join("codex.exe");
        write_test_executable(&install_codex);

        let local_app_data = temp.path().join("LocalAppData");
        let local_app_codex = local_app_data
            .join("Programs")
            .join("OpenAI")
            .join("Codex")
            .join("bin")
            .join("codex.exe");
        write_test_executable(&local_app_codex);

        let mut env = BTreeMap::new();
        env.insert(
            "CODEX_INSTALL_DIR".to_string(),
            install_dir.display().to_string(),
        );
        env.insert(
            "LOCALAPPDATA".to_string(),
            local_app_data.display().to_string(),
        );

        assert_eq!(find_codex_binary(&env), Some(install_codex));
    }

    #[test]
    fn find_codex_binary_finds_official_windows_installer_path() {
        let temp = tempdir().unwrap();
        let local_app_data = temp.path().join("LocalAppData");
        let codex = local_app_data
            .join("Programs")
            .join("OpenAI")
            .join("Codex")
            .join("bin")
            .join("codex.exe");
        write_test_executable(&codex);

        let mut env = BTreeMap::new();
        env.insert(
            "LOCALAPPDATA".to_string(),
            local_app_data.display().to_string(),
        );

        assert_eq!(find_codex_binary(&env), Some(codex));
    }

    #[test]
    fn find_codex_binary_prefers_codex_home_before_user_profile_standalone() {
        let temp = tempdir().unwrap();
        let codex_home = temp.path().join("custom-codex-home");
        let codex_home_binary = codex_home
            .join("packages")
            .join("standalone")
            .join("current")
            .join("bin")
            .join("codex.exe");
        write_test_executable(&codex_home_binary);

        let user_profile = temp.path().join("Users").join("lee");
        let user_profile_binary = user_profile
            .join(".codex")
            .join("packages")
            .join("standalone")
            .join("current")
            .join("bin")
            .join("codex.exe");
        write_test_executable(&user_profile_binary);

        let mut env = BTreeMap::new();
        env.insert("CODEX_HOME".to_string(), codex_home.display().to_string());
        env.insert(
            "USERPROFILE".to_string(),
            user_profile.display().to_string(),
        );

        assert_eq!(find_codex_binary(&env), Some(codex_home_binary));
    }

    #[test]
    fn find_codex_binary_finds_windows_npm_global_cmd() {
        let temp = tempdir().unwrap();
        let app_data = temp.path().join("AppData").join("Roaming");
        let codex = app_data.join("npm").join("codex.cmd");
        write_test_executable(&codex);

        let mut env = BTreeMap::new();
        env.insert("APPDATA".to_string(), app_data.display().to_string());

        assert_eq!(find_codex_binary(&env), Some(codex));
    }

    #[test]
    fn provider_env_keeps_windows_codex_environment_and_path_key() {
        let temp = tempdir().unwrap();
        let bin_dir = temp.path().join("codex-bin");
        let binary = bin_dir.join("codex.exe");
        write_test_executable(&binary);

        let mut env = BTreeMap::new();
        env.insert("Path".to_string(), "C:\\Windows\\System32".to_string());
        env.insert("USERPROFILE".to_string(), "C:\\Users\\lee".to_string());
        env.insert(
            "APPDATA".to_string(),
            "C:\\Users\\lee\\AppData\\Roaming".to_string(),
        );
        env.insert(
            "LOCALAPPDATA".to_string(),
            "C:\\Users\\lee\\AppData\\Local".to_string(),
        );
        env.insert("SystemRoot".to_string(), "C:\\Windows".to_string());
        env.insert(
            "ComSpec".to_string(),
            "C:\\Windows\\System32\\cmd.exe".to_string(),
        );
        env.insert(
            "PATHEXT".to_string(),
            ".COM;.EXE;.CMD;.BAT;.PS1".to_string(),
        );
        env.insert(
            "TEMP".to_string(),
            "C:\\Users\\lee\\AppData\\Local\\Temp".to_string(),
        );
        env.insert(
            "TMP".to_string(),
            "C:\\Users\\lee\\AppData\\Local\\Temp".to_string(),
        );

        let provider_env = provider_env(&env, &binary);

        assert_eq!(
            provider_env.get("USERPROFILE").map(String::as_str),
            Some("C:\\Users\\lee")
        );
        assert_eq!(
            provider_env.get("APPDATA").map(String::as_str),
            Some("C:\\Users\\lee\\AppData\\Roaming")
        );
        assert_eq!(
            provider_env.get("LOCALAPPDATA").map(String::as_str),
            Some("C:\\Users\\lee\\AppData\\Local")
        );
        assert_eq!(
            provider_env.get("SystemRoot").map(String::as_str),
            Some("C:\\Windows")
        );
        assert_eq!(
            provider_env.get("ComSpec").map(String::as_str),
            Some("C:\\Windows\\System32\\cmd.exe")
        );
        assert_eq!(
            provider_env.get("PATHEXT").map(String::as_str),
            Some(".COM;.EXE;.CMD;.BAT;.PS1")
        );
        assert_eq!(
            provider_env.get("TEMP").map(String::as_str),
            Some("C:\\Users\\lee\\AppData\\Local\\Temp")
        );
        assert_eq!(
            provider_env.get("TMP").map(String::as_str),
            Some("C:\\Users\\lee\\AppData\\Local\\Temp")
        );
        let path = provider_env.get("Path").expect("Path should be preserved");
        assert!(path.contains("C:\\Windows\\System32"));
        assert!(path.contains(&bin_dir.display().to_string()));
    }

    fn write_test_executable(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "#!/bin/sh\nexit 0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(path).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(path, permissions).unwrap();
        }
    }

    #[cfg(windows)]
    fn copy_process_env_if_present(env: &mut BTreeMap<String, String>, key: &str) {
        if let Ok(value) = std::env::var(key) {
            if !value.trim().is_empty() {
                env.insert(key.to_string(), value);
            }
        }
    }
}

fn strip_markdown_fence(text: &str) -> String {
    let trimmed = text.trim();
    if !trimmed.starts_with("```") || !trimmed.ends_with("```") {
        return trimmed.to_string();
    }

    let mut lines = trimmed.lines();
    let first = lines.next().unwrap_or_default();
    if !first.starts_with("```") {
        return trimmed.to_string();
    }

    let body = lines.collect::<Vec<_>>();
    if body.last().is_some_and(|line| line.trim() == "```") {
        body[..body.len().saturating_sub(1)]
            .join("\n")
            .trim()
            .to_string()
    } else {
        trimmed.to_string()
    }
}

fn extract_jsonl_text(stdout: &str) -> Option<String> {
    let mut latest = None;
    for line in stdout
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with('{'))
    {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let text = extract_text_from_json_object(&value).trim().to_string();
        if !text.is_empty() {
            latest = Some(text);
        }
    }
    latest
}

fn extract_text_from_json_object(value: &serde_json::Value) -> String {
    if let Some(text) = value.get("text").and_then(|value| value.as_str()) {
        return text.to_string();
    }
    if let Some(content) = value.get("content").and_then(|value| value.as_str()) {
        return content.to_string();
    }
    if let Some(content) = value.get("content").and_then(|value| value.as_array()) {
        return content
            .iter()
            .map(extract_text_from_json_object)
            .collect::<Vec<_>>()
            .join("");
    }
    if let Some(message) = value.get("message") {
        return extract_text_from_json_object(message);
    }
    if let Some(item) = value.get("item") {
        return extract_text_from_json_object(item);
    }
    String::new()
}
