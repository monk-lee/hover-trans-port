use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use tempfile::tempdir;

use crate::messages::{ProviderId, ProviderStatusEntry};
use crate::process::{run_process, ProcessRequest, ProviderError};
use crate::prompt::build_translate_prompt;
use crate::providers::{
    Provider, ProviderModelCatalog, ProviderModelOption, ProviderTranslateRequest,
    ProviderTranslateResult,
};

const DEFAULT_STATUS_TIMEOUT_MS: u64 = 5_000;

#[derive(Clone, Debug)]
pub struct OpencodeProvider {
    env: BTreeMap<String, String>,
}

impl OpencodeProvider {
    pub fn new(env: BTreeMap<String, String>) -> Self {
        Self { env }
    }

    fn find_binary(&self) -> Option<PathBuf> {
        find_opencode_binary(&self.env)
    }
}

impl Provider for OpencodeProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Opencode
    }

    fn label(&self) -> &'static str {
        "OpenCode CLI"
    }

    fn default_model(&self) -> &'static str {
        ""
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
        opencode_fallback_model_catalog()
    }

    fn translate(
        &self,
        request: ProviderTranslateRequest,
    ) -> Result<ProviderTranslateResult, ProviderError> {
        let Some(binary) = self.find_binary() else {
            return Err(ProviderError::NotFound {
                executable: PathBuf::from("opencode"),
            });
        };

        let temp_dir = tempdir().map_err(|error| ProviderError::SpawnFailed {
            message: error.to_string(),
        })?;
        let prompt =
            build_translate_prompt(&request.text, &request.source_lang, &request.target_lang);
        let output = run_process(ProcessRequest {
            executable: binary.clone(),
            args: build_opencode_args(request.model.as_deref(), temp_dir.path(), &prompt),
            cwd: Some(temp_dir.path().to_path_buf()),
            env: provider_env(&self.env, &binary),
            stdin: String::new(),
            timeout_ms: request.timeout_ms,
        })
        .map_err(map_opencode_process_error)?;

        Ok(ProviderTranslateResult {
            translated_text: parse_opencode_output(&output.stdout)?,
            elapsed_ms: output.elapsed_ms,
        })
    }
}

pub fn build_opencode_args(model: Option<&str>, dir: &Path, prompt: &str) -> Vec<String> {
    let mut args = vec![
        "run".to_string(),
        "--format".to_string(),
        "json".to_string(),
        "--pure".to_string(),
        "--dir".to_string(),
        dir.display().to_string(),
    ];

    if let Some(model) = model
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("default"))
    {
        args.push("--model".to_string());
        args.push(model.to_string());
    }

    args.push(prompt.to_string());
    args
}

pub fn parse_opencode_output(stdout: &str) -> Result<String, ProviderError> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err(ProviderError::OutputParseFailed {
            message: "OpenCode output was empty.".to_string(),
        });
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(message) = parse_opencode_error_message_from_value(&value) {
            return Err(ProviderError::ExitNonzero {
                exit_code: Some(1),
                stdout: trimmed.to_string(),
                stderr: message,
                elapsed_ms: 0,
            });
        }

        let text = extract_text_from_opencode_value(&value).trim().to_string();
        if !text.is_empty() {
            return Ok(text);
        }
    }

    let mut latest_text = None;
    for line in trimmed
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with('{'))
    {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };

        if parse_opencode_error_message_from_value(&value).is_some() {
            continue;
        }

        let text = extract_text_from_opencode_value(&value).trim().to_string();
        if !text.is_empty() {
            latest_text = Some(text);
        }
    }

    Ok(latest_text.unwrap_or_else(|| trimmed.to_string()))
}

fn opencode_fallback_model_catalog() -> ProviderModelCatalog {
    ProviderModelCatalog {
        provider: ProviderId::Opencode,
        default_model: String::new(),
        models: vec![ProviderModelOption {
            value: String::new(),
            label: "Default (OpenCode CLI)".to_string(),
            recommended: Some(true),
        }],
        supports_custom_model: true,
        source: "fallback".to_string(),
    }
}

fn map_opencode_process_error(error: ProviderError) -> ProviderError {
    let ProviderError::ExitNonzero {
        exit_code,
        stdout,
        stderr,
        elapsed_ms,
    } = error
    else {
        return error;
    };

    let message = parse_opencode_error_message(&stdout)
        .or_else(|| parse_opencode_error_message(&stderr))
        .unwrap_or_else(|| {
            let stderr = stderr.trim();
            if !stderr.is_empty() {
                stderr.to_string()
            } else {
                stdout.trim().to_string()
            }
        });

    ProviderError::ExitNonzero {
        exit_code,
        stdout,
        stderr: message,
        elapsed_ms,
    }
}

fn parse_opencode_error_message(output: &str) -> Option<String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(message) = parse_opencode_error_message_from_value(&value) {
            return Some(message);
        }
    }

    for line in trimmed
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with('{'))
    {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if let Some(message) = parse_opencode_error_message_from_value(&value) {
            return Some(message);
        }
    }

    None
}

fn parse_opencode_error_message_from_value(value: &serde_json::Value) -> Option<String> {
    let type_is_error = value
        .get("type")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|value| value.eq_ignore_ascii_case("error"));
    let is_error = value
        .get("is_error")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let error_value = value.get("error").filter(|error| !error.is_null());

    if !type_is_error && !is_error && error_value.is_none() {
        return None;
    }

    if let Some(error) = error_value {
        if let Some(message) = error
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(message.to_string());
        }

        for key in ["message", "type", "code"] {
            if let Some(message) = error
                .get(key)
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return Some(message.to_string());
            }
        }

        return Some(error.to_string());
    }

    for key in ["message", "result", "text"] {
        if let Some(message) = value
            .get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(message.to_string());
        }
    }

    Some(value.to_string())
}

fn extract_text_from_opencode_value(value: &serde_json::Value) -> String {
    if parse_opencode_error_message_from_value(value).is_some() {
        return String::new();
    }

    for key in ["text", "response", "result"] {
        if let Some(text) = value.get(key).and_then(serde_json::Value::as_str) {
            return text.to_string();
        }
    }

    if let Some(content) = value.get("content") {
        return extract_content_text(content);
    }

    for key in ["message", "data", "item", "part", "delta"] {
        if let Some(nested) = value.get(key) {
            let text = extract_text_from_opencode_value(nested);
            if !text.trim().is_empty() {
                return text;
            }
        }
    }

    String::new()
}

fn extract_content_text(value: &serde_json::Value) -> String {
    if let Some(text) = value.as_str() {
        return text.to_string();
    }

    if let Some(values) = value.as_array() {
        return values
            .iter()
            .map(extract_text_from_opencode_value)
            .collect::<Vec<_>>()
            .join("");
    }

    extract_text_from_opencode_value(value)
}

fn find_opencode_binary(env: &BTreeMap<String, String>) -> Option<PathBuf> {
    if let Some(path) = env
        .get("HOVER_TRANS_PORT_OPENCODE_PATH")
        .filter(|value| !value.trim().is_empty())
    {
        let candidate = PathBuf::from(path);
        return is_executable(&candidate).then_some(candidate);
    }

    let mut candidates = Vec::new();
    if let Some(path) = env.get("PATH") {
        candidates.extend(
            path.split(':')
                .filter(|value| !value.is_empty())
                .map(|dir| Path::new(dir).join("opencode")),
        );
    }
    if let Some(home) = env.get("HOME").filter(|value| !value.trim().is_empty()) {
        candidates.push(
            Path::new(home)
                .join(".opencode")
                .join("bin")
                .join("opencode"),
        );
        candidates.push(Path::new(home).join(".local").join("bin").join("opencode"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/opencode"));
    candidates.push(PathBuf::from("/usr/local/bin/opencode"));
    candidates.push(PathBuf::from("/usr/bin/opencode"));

    candidates
        .into_iter()
        .find(|candidate| is_executable(candidate))
}

fn provider_env(env: &BTreeMap<String, String>, binary: &Path) -> BTreeMap<String, String> {
    let mut next = BTreeMap::new();
    for key in [
        "HOME",
        "PATH",
        "TMPDIR",
        "USER",
        "LANG",
        "LC_ALL",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_CACHE_HOME",
        "OPENCODE_CONFIG",
        "OPENCODE_SERVER_PASSWORD",
        "OPENCODE_SERVER_USERNAME",
    ] {
        if let Some(value) = env.get(key).filter(|value| !value.is_empty()) {
            next.insert(key.to_string(), value.clone());
        }
    }
    if let Some(parent) = binary.parent() {
        let path = next.remove("PATH").unwrap_or_default();
        next.insert("PATH".to_string(), format!("{path}:{}", parent.display()));
    }
    next.entry("LANG".to_string())
        .or_insert_with(|| "en_US.UTF-8".to_string());
    next
}

fn compact_version(stdout: &str) -> String {
    stdout.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_executable(path: &Path) -> bool {
    path.is_file()
        && path
            .metadata()
            .map(|metadata| {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    metadata.permissions().mode() & 0o111 != 0
                }
                #[cfg(not(unix))]
                {
                    !metadata.permissions().readonly()
                }
            })
            .unwrap_or(false)
}
