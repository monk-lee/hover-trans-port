use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use tempfile::tempdir;

use crate::messages::{ProviderId, ProviderStatusEntry};
use crate::process::{run_process, ProcessRequest, ProviderError};
use crate::prompt::build_translate_prompt;
use crate::providers::{Provider, ProviderTranslateRequest, ProviderTranslateResult};

const DEFAULT_CODEX_MODEL: &str = "gpt-5.4-mini";
const DEFAULT_STATUS_TIMEOUT_MS: u64 = 5_000;

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
    if let Some(path) = env
        .get("HOVER_TRANS_PORT_CODEX_PATH")
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
                .map(|dir| Path::new(dir).join("codex")),
        );
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/codex"));
    candidates.push(PathBuf::from("/usr/local/bin/codex"));
    candidates.push(PathBuf::from("/usr/bin/codex"));

    candidates
        .into_iter()
        .find(|candidate| is_executable(candidate))
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

fn provider_env(env: &BTreeMap<String, String>, binary: &Path) -> BTreeMap<String, String> {
    let mut next = BTreeMap::new();
    for key in ["HOME", "CODEX_HOME", "TMPDIR", "USER", "LANG", "LC_ALL"] {
        if let Some(value) = env.get(key).filter(|value| !value.is_empty()) {
            next.insert(key.to_string(), value.clone());
        }
    }

    let mut path_parts = Vec::new();
    if let Some(path) = env.get("PATH").filter(|value| !value.is_empty()) {
        path_parts.push(path.clone());
    }
    if let Some(parent) = binary.parent() {
        path_parts.push(parent.display().to_string());
    }
    if !path_parts.is_empty() {
        next.insert("PATH".to_string(), path_parts.join(":"));
    }
    next.entry("LANG".to_string())
        .or_insert_with(|| "en_US.UTF-8".to_string());

    next
}

fn compact_version(stdout: &str) -> String {
    stdout.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn resolve_codex_model(
    env: &BTreeMap<String, String>,
    requested: Option<&str>,
    fallback: &str,
) -> String {
    env.get("HOVER_TRANS_PORT_CODEX_MODEL")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .or_else(|| requested.map(str::trim).filter(|value| !value.is_empty()))
        .unwrap_or(fallback)
        .to_string()
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
