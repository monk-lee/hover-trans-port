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

const PROMPT_ARG: &str =
    "Translate according to the instructions provided on stdin. Return only the translated text.";
const DEFAULT_CLAUDE_MODEL: &str = "haiku";
const DEFAULT_STATUS_TIMEOUT_MS: u64 = 5_000;

#[derive(Clone, Debug)]
pub struct ClaudeProvider {
    env: BTreeMap<String, String>,
}

impl ClaudeProvider {
    pub fn new(env: BTreeMap<String, String>) -> Self {
        Self { env }
    }

    fn find_binary(&self) -> Option<PathBuf> {
        find_binary(&self.env, "HOVER_TRANS_PORT_CLAUDE_PATH", "claude")
    }
}

impl Provider for ClaudeProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Claude
    }

    fn label(&self) -> &'static str {
        "Claude CLI"
    }

    fn default_model(&self) -> &'static str {
        DEFAULT_CLAUDE_MODEL
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
                version: Some(
                    output
                        .stdout
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" "),
                ),
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
        ProviderModelCatalog {
            provider: self.id(),
            default_model: self.default_model().to_string(),
            models: vec![
                ProviderModelOption {
                    value: "haiku".to_string(),
                    label: "Haiku".to_string(),
                    recommended: Some(true),
                },
                ProviderModelOption {
                    value: "sonnet".to_string(),
                    label: "Sonnet".to_string(),
                    recommended: None,
                },
                ProviderModelOption {
                    value: "opus".to_string(),
                    label: "Opus".to_string(),
                    recommended: None,
                },
                ProviderModelOption {
                    value: "default".to_string(),
                    label: "Default (Claude CLI)".to_string(),
                    recommended: None,
                },
            ],
            supports_custom_model: true,
            source: "fallback".to_string(),
        }
    }

    fn translate(
        &self,
        request: ProviderTranslateRequest,
    ) -> Result<ProviderTranslateResult, ProviderError> {
        let Some(binary) = self.find_binary() else {
            return Err(ProviderError::NotFound {
                executable: PathBuf::from("claude"),
            });
        };
        let temp_dir = tempdir().map_err(|error| ProviderError::SpawnFailed {
            message: error.to_string(),
        })?;
        let prompt =
            build_translate_prompt(&request.text, &request.source_lang, &request.target_lang);
        let model = request
            .model
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(self.default_model());
        let output = run_process(ProcessRequest {
            executable: binary.clone(),
            args: build_claude_args(Some(model)),
            cwd: Some(temp_dir.path().to_path_buf()),
            env: provider_env(&self.env, &binary),
            stdin: prompt,
            timeout_ms: request.timeout_ms,
        })
        .map_err(map_claude_process_error)?;

        Ok(ProviderTranslateResult {
            translated_text: parse_claude_output(&output.stdout)?,
            elapsed_ms: output.elapsed_ms,
        })
    }
}

pub fn build_claude_args(model: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "-p".to_string(),
        PROMPT_ARG.to_string(),
        "--output-format".to_string(),
        "json".to_string(),
        "--no-session-persistence".to_string(),
        "--tools".to_string(),
        String::new(),
    ];
    if let Some(model) = model
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("default"))
    {
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    args
}

pub fn parse_claude_output(stdout: &str) -> Result<String, ProviderError> {
    let value = serde_json::from_str::<serde_json::Value>(stdout.trim()).map_err(|error| {
        ProviderError::OutputParseFailed {
            message: error.to_string(),
        }
    })?;

    if value
        .get("is_error")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        let message = parse_claude_error_message(stdout).unwrap_or_else(|| value.to_string());
        return Err(ProviderError::ExitNonzero {
            exit_code: Some(1),
            stdout: stdout.trim().to_string(),
            stderr: message,
            elapsed_ms: 0,
        });
    }

    value
        .get("result")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| ProviderError::OutputParseFailed {
            message: "Claude output did not include result.".to_string(),
        })
}

fn map_claude_process_error(error: ProviderError) -> ProviderError {
    let ProviderError::ExitNonzero {
        exit_code,
        stdout,
        stderr,
        elapsed_ms,
    } = error
    else {
        return error;
    };

    let message = parse_claude_error_message(&stdout)
        .or_else(|| parse_claude_error_message(&stderr))
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

fn parse_claude_error_message(output: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(output.trim()).ok()?;
    if !value
        .get("is_error")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        return None;
    }

    for key in ["result", "message", "error"] {
        let message = value
            .get(key)
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty());

        if let Some(message) = message {
            return Some(message.to_string());
        }
    }

    Some(value.to_string())
}

fn find_binary(
    env: &BTreeMap<String, String>,
    override_key: &str,
    binary_name: &str,
) -> Option<PathBuf> {
    if let Some(path) = env
        .get(override_key)
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
                .map(|dir| Path::new(dir).join(binary_name)),
        );
    }
    if let Some(home) = env.get("HOME").filter(|value| !value.trim().is_empty()) {
        candidates.push(Path::new(home).join(".local").join("bin").join(binary_name));
    }
    candidates.push(Path::new("/opt/homebrew/bin").join(binary_name));
    candidates.push(Path::new("/usr/local/bin").join(binary_name));
    candidates.push(Path::new("/usr/bin").join(binary_name));

    candidates
        .into_iter()
        .find(|candidate| is_executable(candidate))
}

fn provider_env(env: &BTreeMap<String, String>, binary: &Path) -> BTreeMap<String, String> {
    let mut next = BTreeMap::new();
    for key in ["HOME", "PATH", "TMPDIR", "USER", "LANG", "LC_ALL"] {
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
