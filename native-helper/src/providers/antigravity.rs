use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use tempfile::tempdir;

use crate::messages::{ProviderId, ProviderStatusEntry};
use crate::process::{run_process, ProcessRequest, ProviderError};
use crate::providers::{
    binary_discovery, Provider, ProviderModelCatalog, ProviderModelOption, ProviderPromptRequest,
    ProviderPromptResult,
};

const PREFERRED_MEDIUM_MODELS: &[&str] = &[
    "gemini-3.8-flash-medium",
    "gemini-3.7-flash-medium",
    "gemini-3.6-flash-medium",
    "gemini-4-hydrogen-medium",
];
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
        "default"
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
        let mut catalog = ProviderModelCatalog::with_cli_default(self.id(), self.label(), false);
        let Some(binary) = self.find_binary() else {
            return catalog;
        };
        let probe = |args: &[&str]| {
            run_process(ProcessRequest {
                executable: binary.clone(),
                args: args.iter().map(|arg| arg.to_string()).collect(),
                cwd: None,
                env: provider_env(&self.env, &binary),
                stdin: String::new(),
                timeout_ms: 5_000,
            })
        };
        // Old versions accept a positional prompt. Only run the subcommand if advertised.
        let Ok(help) = probe(&["--help"]) else {
            return catalog;
        };
        if !help
            .stdout
            .lines()
            .chain(help.stderr.lines())
            .any(|line| line.split_whitespace().next() == Some("models"))
        {
            return catalog;
        }
        let Ok(output) = probe(&["models"]) else {
            return catalog;
        };
        for line in output.stdout.lines() {
            let Some((slug, label)) = line.trim().split_once(char::is_whitespace) else {
                continue;
            };
            if !slug.contains('-')
                || !slug
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'.' | b'_'))
            {
                continue;
            }
            catalog.models.push(ProviderModelOption {
                value: slug.to_string(),
                label: label.trim().to_string(),
                recommended: None,
            });
        }
        if catalog.models.len() > 1 {
            catalog.source = "cli".to_string();
            if let Some(index) = PREFERRED_MEDIUM_MODELS
                .iter()
                .find_map(|slug| catalog.models.iter().position(|entry| entry.value == *slug))
            {
                catalog.recommend(index);
            }
        }
        catalog
    }

    fn run_prompt(
        &self,
        request: ProviderPromptRequest,
    ) -> Result<ProviderPromptResult, ProviderError> {
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
        let model = request
            .model
            .unwrap_or_else(|| self.model_catalog().default_model);
        let output = run_process(ProcessRequest {
            executable: binary.clone(),
            args: build_antigravity_args(request.timeout_ms, &log_file, &request.prompt, &model),
            cwd: Some(workspace_dir),
            env: provider_env(&self.env, &binary),
            stdin: String::new(),
            timeout_ms: antigravity_process_timeout_ms(request.timeout_ms),
        })
        .map_err(map_antigravity_process_error)?;

        Ok(ProviderPromptResult {
            text: parse_antigravity_output(&output.stdout)?,
            elapsed_ms: output.elapsed_ms,
        })
    }
}

pub fn build_antigravity_args(
    timeout_ms: u64,
    log_file: &Path,
    prompt: &str,
    model: &str,
) -> Vec<String> {
    let mut args = vec![
        "--log-file".to_string(),
        log_file.display().to_string(),
        "--print-timeout".to_string(),
        timeout_ms_to_duration_arg(timeout_ms),
        "--sandbox".to_string(),
    ];
    if !model.is_empty() && model != "default" {
        args.extend(["--model".to_string(), model.to_string()]);
    }
    args.extend(["--print".to_string(), prompt.to_string()]);
    args
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
