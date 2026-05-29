use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use tempfile::tempdir;

use crate::messages::{ProviderId, ProviderStatusEntry};
use crate::process::{run_process, ProcessRequest, ProviderError};
use crate::prompt::build_translate_prompt;
use crate::providers::{
    binary_discovery, Provider, ProviderModelCatalog, ProviderModelOption,
    ProviderTranslateRequest, ProviderTranslateResult,
};

const PROMPT_ARG: &str =
    "Translate according to the instructions provided on stdin. Return only the translated text.";
const DEFAULT_STATUS_TIMEOUT_MS: u64 = 5_000;
const GEMINI_WORKSPACE_SETTINGS: &str = r#"{"tools":{"core":[]},"context":{"fileName":[]}}"#;

#[derive(Clone, Debug)]
pub struct GeminiProvider {
    env: BTreeMap<String, String>,
}

impl GeminiProvider {
    pub fn new(env: BTreeMap<String, String>) -> Self {
        Self { env }
    }

    fn find_binary(&self) -> Option<PathBuf> {
        binary_discovery::find_provider_binary(&self.env, "HOVER_TRANS_PORT_GEMINI_PATH", "gemini")
    }
}

impl Provider for GeminiProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Gemini
    }

    fn label(&self) -> &'static str {
        "Gemini CLI"
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
        gemini_fallback_model_catalog()
    }

    fn translate(
        &self,
        request: ProviderTranslateRequest,
    ) -> Result<ProviderTranslateResult, ProviderError> {
        let Some(binary) = self.find_binary() else {
            return Err(ProviderError::NotFound {
                executable: PathBuf::from("gemini"),
            });
        };
        let temp_dir = tempdir().map_err(|error| ProviderError::SpawnFailed {
            message: error.to_string(),
        })?;
        prepare_gemini_workspace(temp_dir.path())?;
        let prompt =
            build_translate_prompt(&request.text, &request.source_lang, &request.target_lang);
        let output = run_process(ProcessRequest {
            executable: binary.clone(),
            args: build_gemini_args(request.model.as_deref()),
            cwd: Some(temp_dir.path().to_path_buf()),
            env: provider_env(&self.env, &binary),
            stdin: prompt,
            timeout_ms: request.timeout_ms,
        })
        .map_err(map_gemini_process_error)?;

        Ok(ProviderTranslateResult {
            translated_text: parse_gemini_output(&output.stdout)?,
            elapsed_ms: output.elapsed_ms,
        })
    }
}

pub fn build_gemini_args(model: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "-p".to_string(),
        PROMPT_ARG.to_string(),
        "--output-format".to_string(),
        "json".to_string(),
        "--extensions".to_string(),
        "none".to_string(),
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

fn prepare_gemini_workspace(path: &Path) -> Result<(), ProviderError> {
    let gemini_dir = path.join(".gemini");
    fs::create_dir_all(&gemini_dir).map_err(|error| ProviderError::SpawnFailed {
        message: error.to_string(),
    })?;
    fs::write(gemini_dir.join("settings.json"), GEMINI_WORKSPACE_SETTINGS).map_err(|error| {
        ProviderError::SpawnFailed {
            message: error.to_string(),
        }
    })
}

fn gemini_fallback_model_catalog() -> ProviderModelCatalog {
    ProviderModelCatalog {
        provider: ProviderId::Gemini,
        default_model: String::new(),
        models: vec![
            ProviderModelOption {
                value: String::new(),
                label: "Default (Gemini CLI)".to_string(),
                recommended: Some(true),
            },
            ProviderModelOption {
                value: "gemini-2.5-flash".to_string(),
                label: "Gemini 2.5 Flash".to_string(),
                recommended: None,
            },
            ProviderModelOption {
                value: "gemini-2.5-pro".to_string(),
                label: "Gemini 2.5 Pro".to_string(),
                recommended: None,
            },
        ],
        supports_custom_model: true,
        source: "fallback".to_string(),
    }
}

pub fn parse_gemini_output(stdout: &str) -> Result<String, ProviderError> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err(ProviderError::OutputParseFailed {
            message: "Gemini output was empty.".to_string(),
        });
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(message) = parse_gemini_error_message_from_value(&value) {
            return Err(ProviderError::ExitNonzero {
                exit_code: Some(1),
                stdout: trimmed.to_string(),
                stderr: message,
                elapsed_ms: 0,
            });
        }

        for key in ["response", "result", "text", "content"] {
            if let Some(text) = value.get(key).and_then(|value| value.as_str()) {
                let text = text.trim();
                if !text.is_empty() {
                    return Ok(text.to_string());
                }
            }
        }

        return Err(ProviderError::OutputParseFailed {
            message: "Gemini output did not include response.".to_string(),
        });
    }

    Ok(trimmed.to_string())
}

fn map_gemini_process_error(error: ProviderError) -> ProviderError {
    let ProviderError::ExitNonzero {
        exit_code,
        stdout,
        stderr,
        elapsed_ms,
    } = error
    else {
        return error;
    };

    let message = parse_gemini_error_message(&stdout)
        .or_else(|| parse_gemini_error_message(&stderr))
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

fn parse_gemini_error_message(output: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(output.trim()).ok()?;
    parse_gemini_error_message_from_value(&value)
}

fn parse_gemini_error_message_from_value(value: &serde_json::Value) -> Option<String> {
    let error = value.get("error")?;

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
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(message.to_string());
        }
    }

    Some(error.to_string())
}

fn provider_env(env: &BTreeMap<String, String>, binary: &Path) -> BTreeMap<String, String> {
    let mut next = binary_discovery::provider_launch_env(
        env,
        binary,
        &["HOME", "TMPDIR", "USER", "LANG", "LC_ALL"],
    );
    next.entry("LANG".to_string())
        .or_insert_with(|| "en_US.UTF-8".to_string());
    next
}
