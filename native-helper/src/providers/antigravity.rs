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

const PRINT_TIMEOUT_GRACE_MS: u64 = 500;

#[derive(Clone, Debug)]
pub struct AntigravityProvider {
    env: BTreeMap<String, String>,
}

impl AntigravityProvider {
    pub fn new(env: BTreeMap<String, String>) -> Self {
        Self { env }
    }

    fn find_binary(&self) -> Option<PathBuf> {
        binary_discovery::find_provider_binary(
            &self.env,
            "HOVER_TRANS_PORT_ANTIGRAVITY_PATH",
            "agy",
        )
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

        ProviderStatusEntry {
            id: self.id(),
            available: true,
            binary_path: Some(binary.display().to_string()),
            version: None,
            error: None,
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
            timeout_ms: antigravity_process_timeout_ms(request.timeout_ms),
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

pub fn antigravity_process_timeout_ms(timeout_ms: u64) -> u64 {
    rounded_timeout_ms(timeout_ms).saturating_add(PRINT_TIMEOUT_GRACE_MS)
}

fn rounded_timeout_ms(timeout_ms: u64) -> u64 {
    let seconds = (timeout_ms.saturating_add(999) / 1_000).max(1);
    seconds.saturating_mul(1_000)
}

fn timeout_ms_to_duration_arg(timeout_ms: u64) -> String {
    let seconds = rounded_timeout_ms(timeout_ms) / 1_000;
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
