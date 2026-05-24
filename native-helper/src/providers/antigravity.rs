use std::collections::BTreeMap;
use std::fs;
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
pub struct AntigravityProvider {
    env: BTreeMap<String, String>,
}

impl AntigravityProvider {
    pub fn new(env: BTreeMap<String, String>) -> Self {
        Self { env }
    }

    fn find_binary(&self) -> Option<PathBuf> {
        find_binary(&self.env, "HOVER_TRANS_PORT_ANTIGRAVITY_PATH", "agy")
    }
}

impl Provider for AntigravityProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Antigravity
    }

    fn label(&self) -> &'static str {
        "Antigravity CLI"
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
        ProviderModelCatalog {
            provider: self.id(),
            default_model: String::new(),
            models: vec![ProviderModelOption {
                value: String::new(),
                label: "Default (Antigravity CLI)".to_string(),
                recommended: Some(true),
            }],
            supports_custom_model: false,
            source: "fallback".to_string(),
        }
    }

    fn translate(
        &self,
        request: ProviderTranslateRequest,
    ) -> Result<ProviderTranslateResult, ProviderError> {
        let Some(binary) = self.find_binary() else {
            return Err(ProviderError::NotFound {
                executable: PathBuf::from("agy"),
            });
        };
        let workspace_dir = resolve_antigravity_workspace(&self.env);
        fs::create_dir_all(&workspace_dir).map_err(|error| ProviderError::SpawnFailed {
            message: error.to_string(),
        })?;
        let temp_dir = tempdir().map_err(|error| ProviderError::SpawnFailed {
            message: error.to_string(),
        })?;
        let log_file = temp_dir.path().join("antigravity.log");
        let prompt =
            build_translate_prompt(&request.text, &request.source_lang, &request.target_lang);
        let output = run_process(ProcessRequest {
            executable: binary.clone(),
            args: build_antigravity_args(request.timeout_ms, &log_file, &prompt),
            cwd: Some(workspace_dir),
            env: provider_env(&self.env, &binary),
            stdin: String::new(),
            timeout_ms: request.timeout_ms,
        })
        .map_err(map_antigravity_process_error)?;

        Ok(ProviderTranslateResult {
            translated_text: parse_antigravity_output(&output.stdout)?,
            elapsed_ms: output.elapsed_ms,
        })
    }
}

pub fn build_antigravity_args(timeout_ms: u64, log_file: &Path, prompt: &str) -> Vec<String> {
    vec![
        "--log-file".to_string(),
        log_file.display().to_string(),
        "--print-timeout".to_string(),
        timeout_ms_to_duration_arg(timeout_ms),
        "--sandbox".to_string(),
        "--print".to_string(),
        prompt.to_string(),
    ]
}

pub fn parse_antigravity_output(stdout: &str) -> Result<String, ProviderError> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err(ProviderError::OutputParseFailed {
            message: "Antigravity output was empty.".to_string(),
        });
    }
    Ok(trimmed.to_string())
}

fn timeout_ms_to_duration_arg(timeout_ms: u64) -> String {
    let seconds = (timeout_ms.saturating_add(999) / 1_000).max(1);
    format!("{seconds}s")
}

fn map_antigravity_process_error(error: ProviderError) -> ProviderError {
    let ProviderError::ExitNonzero {
        exit_code,
        stdout,
        stderr,
        elapsed_ms,
    } = error
    else {
        return error;
    };

    let message = if !stderr.trim().is_empty() {
        stderr.trim().to_string()
    } else {
        stdout.trim().to_string()
    };

    ProviderError::ExitNonzero {
        exit_code,
        stdout,
        stderr: message,
        elapsed_ms,
    }
}

fn resolve_antigravity_workspace(env: &BTreeMap<String, String>) -> PathBuf {
    if let Some(path) = env
        .get("HOVER_TRANS_PORT_ANTIGRAVITY_WORKSPACE_DIR")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return PathBuf::from(path);
    }

    if let Some(home) = env
        .get("HOME")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return Path::new(home)
            .join(".hover-trans-port")
            .join("antigravity-workspace");
    }

    if let Some(tmpdir) = env
        .get("TMPDIR")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return Path::new(tmpdir).join("hover-trans-port-antigravity-workspace");
    }

    Path::new("/tmp").join("hover-trans-port-antigravity-workspace")
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
