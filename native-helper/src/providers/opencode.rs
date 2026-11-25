use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use tempfile::tempdir;

use crate::messages::{ProviderId, ProviderStatusEntry};
use crate::process::{run_process, ProcessRequest, ProviderError};
use crate::providers::{
    binary_discovery, Provider, ProviderModelCatalog, ProviderModelOption, ProviderPromptRequest,
    ProviderPromptResult,
};

const DEFAULT_STATUS_TIMEOUT_MS: u64 = 5_000;
const OPENCODE_TRANSLATION_AGENT: &str = "build";
const OPENCODE_SESSION_TITLE: &str = "HoverTransPort translation";
const OPENCODE_TRANSLATION_PERMISSION: &str = r#"{"*":"deny","bash":"deny","doom_loop":"deny","edit":"deny","external_directory":"deny","glob":"deny","grep":"deny","lsp":"deny","question":"deny","read":"deny","skill":"deny","task":"deny","webfetch":"deny","websearch":"deny"}"#;

#[derive(Clone, Debug)]
pub struct OpencodeProvider {
    env: BTreeMap<String, String>,
}

impl OpencodeProvider {
    pub fn new(env: BTreeMap<String, String>) -> Self {
        Self { env }
    }

    fn find_binary(&self) -> Option<PathBuf> {
        binary_discovery::find_provider_binary(
            &self.env,
            "HOVER_TRANS_PORT_OPENCODE_PATH",
            "opencode",
        )
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
        let fallback = ProviderModelCatalog::with_cli_default(self.id(), self.label(), true);
        let (Some(binary), Ok(dir)) = (self.find_binary(), tempdir()) else {
            return fallback;
        };
        let output = run_process(ProcessRequest {
            args: vec!["models".into(), "--verbose".into(), "--pure".into()],
            cwd: Some(dir.path().to_path_buf()),
            env: provider_env(&self.env, &binary),
            executable: binary,
            stdin: String::new(),
            timeout_ms: DEFAULT_STATUS_TIMEOUT_MS,
        });
        match output {
            Ok(output) => opencode_model_catalog(&output.stdout, fallback),
            Err(_) => fallback,
        }
    }

    fn run_prompt(
        &self,
        request: ProviderPromptRequest,
    ) -> Result<ProviderPromptResult, ProviderError> {
        let Some(binary) = self.find_binary() else {
            return Err(ProviderError::NotFound {
                executable: PathBuf::from("opencode"),
            });
        };

        let temp_dir = tempdir().map_err(|error| ProviderError::SpawnFailed {
            message: error.to_string(),
        })?;

        let model = request
            .model
            .unwrap_or_else(|| self.model_catalog().default_model);
        let output = run_process(ProcessRequest {
            executable: binary.clone(),
            args: build_opencode_args(Some(&model), temp_dir.path()),
            cwd: Some(temp_dir.path().to_path_buf()),
            env: provider_env(&self.env, &binary),
            stdin: request.prompt,
            timeout_ms: request.timeout_ms,
        })
        .map_err(map_opencode_process_error)?;

        Ok(ProviderPromptResult {
            text: parse_opencode_output(&output.stdout)?,
            elapsed_ms: output.elapsed_ms,
        })
    }
}

pub fn build_opencode_args(model: Option<&str>, dir: &Path) -> Vec<String> {
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
        if let Some(base) = model.strip_suffix("#medium") {
            args.extend([base.to_string(), "--variant".into(), "medium".into()]);
        } else {
            args.push(model.to_string());
        }
    }

    args.push("--agent".to_string());
    args.push(OPENCODE_TRANSLATION_AGENT.to_string());
    args.push("--title".to_string());
    args.push(OPENCODE_SESSION_TITLE.to_string());
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

// OpenCode 1.x prints one provider/model line followed by its pretty-printed JSON.
fn opencode_model_catalog(stdout: &str, mut catalog: ProviderModelCatalog) -> ProviderModelCatalog {
    let mut rest = stdout.trim();
    let mut lowest_cost = f64::INFINITY;
    let mut recommended = None;
    while let Some((id, metadata)) = rest.split_once('\n') {
        let id = id.trim();
        rest = metadata.trim_start();
        if !id.contains('/') || id.chars().any(char::is_whitespace) || !rest.starts_with('{') {
            continue;
        }
        let mut records = serde_json::Deserializer::from_str(rest).into_iter::<serde_json::Value>();
        let Some(Ok(model)) = records.next() else {
            break;
        };
        rest = rest[records.byte_offset()..].trim_start();
        if model["status"] == "deprecated"
            || model["capabilities"]["output"]["text"] != true
            || model["capabilities"]["input"]["text"] != true
        {
            continue;
        }
        catalog.source = "cli".to_string();
        catalog.models.push(ProviderModelOption {
            value: id.to_string(),
            label: id.to_string(),
            recommended: None,
        });
        if !model["variants"]["medium"].is_object() {
            continue;
        }
        catalog.models.push(ProviderModelOption {
            value: format!("{id}#medium"),
            label: format!("{id} (medium)"),
            recommended: None,
        });
        if let (Some(input), Some(output)) = (
            model["cost"]["input"].as_f64(),
            model["cost"]["output"].as_f64(),
        ) {
            let cost = input + output;
            if cost < lowest_cost {
                lowest_cost = cost;
                recommended = Some(catalog.models.len() - 1);
            }
        }
    }
    if let Some(index) = recommended {
        catalog.recommend(index);
    }
    catalog
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

fn provider_env(env: &BTreeMap<String, String>, binary: &Path) -> BTreeMap<String, String> {
    let mut next = binary_discovery::provider_launch_env(
        env,
        binary,
        &[
            "HOME",
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
        ],
    );
    next.entry("LANG".to_string())
        .or_insert_with(|| "en_US.UTF-8".to_string());
    next.insert(
        "OPENCODE_PERMISSION".to_string(),
        OPENCODE_TRANSLATION_PERMISSION.to_string(),
    );
    next
}

fn compact_version(stdout: &str) -> String {
    stdout.split_whitespace().collect::<Vec<_>>().join(" ")
}
