use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

const DEFAULT_LOG_FILENAME: &str = "hover-trans-port.log";
const DEFAULT_TAIL_BYTES: u64 = 32 * 1024;
const DEFAULT_TAIL_LINES: usize = 200;
const MAX_FIELD_COUNT: usize = 50;
const MAX_FIELD_KEY_LEN: usize = 80;
const MAX_FIELD_STRING_LEN: usize = 240;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DebugLogInfo {
    pub log_path: PathBuf,
    pub exists: bool,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DebugLogContent {
    pub info: DebugLogInfo,
    pub content: String,
    pub truncated: bool,
}

pub fn resolve_debug_log_path_from_env(env: &BTreeMap<String, String>) -> PathBuf {
    if let Some(path) = env
        .get("HOVER_TRANS_PORT_LOG_PATH")
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return PathBuf::from(path);
    }

    if let Some(dir) = env
        .get("HOVER_TRANS_PORT_LOG_DIR")
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Path::new(dir).join(DEFAULT_LOG_FILENAME);
    }

    if let Some(home) = env
        .get("HOME")
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Path::new(home)
            .join(".hover-trans-port")
            .join(DEFAULT_LOG_FILENAME);
    }

    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".hover-trans-port")
        .join(DEFAULT_LOG_FILENAME)
}

pub fn debug_log_info(env: &BTreeMap<String, String>) -> std::io::Result<DebugLogInfo> {
    let log_path = resolve_debug_log_path_from_env(env);
    match fs::metadata(&log_path) {
        Ok(metadata) => Ok(DebugLogInfo {
            log_path,
            exists: true,
            size_bytes: metadata.len(),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(DebugLogInfo {
            log_path,
            exists: false,
            size_bytes: 0,
        }),
        Err(error) => Err(error),
    }
}

pub fn clear_debug_log(env: &BTreeMap<String, String>) -> std::io::Result<DebugLogInfo> {
    let log_path = resolve_debug_log_path_from_env(env);
    ensure_parent_dir(&log_path)?;
    File::create(&log_path)?;
    debug_log_info(env)
}

pub fn read_debug_log_tail(
    env: &BTreeMap<String, String>,
    max_bytes: Option<u64>,
    max_lines: Option<usize>,
) -> std::io::Result<DebugLogContent> {
    let info = debug_log_info(env)?;

    if !info.exists || info.size_bytes == 0 {
        return Ok(DebugLogContent {
            info,
            content: String::new(),
            truncated: false,
        });
    }

    let byte_limit = max_bytes
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_TAIL_BYTES);
    let line_limit = max_lines
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_TAIL_LINES);
    let bytes_to_read = byte_limit.min(info.size_bytes);
    let mut file = File::open(&info.log_path)?;
    file.seek(SeekFrom::Start(info.size_bytes - bytes_to_read))?;

    let mut buffer = vec![0_u8; bytes_to_read.try_into().unwrap_or(usize::MAX)];
    file.read_exact(&mut buffer)?;

    let mut content = String::from_utf8_lossy(&buffer).into_owned();
    let mut truncated = info.size_bytes > bytes_to_read;

    if truncated {
        if let Some(index) = content.find('\n') {
            content = content[index + 1..].to_string();
        } else {
            content.clear();
        }
    }

    let lines = content.lines().map(str::to_string).collect::<Vec<_>>();
    if lines.len() > line_limit {
        content = lines[lines.len() - line_limit..].join("\n");
        truncated = true;
    }

    Ok(DebugLogContent {
        info,
        content,
        truncated,
    })
}

pub fn write_debug_log_event(
    env: &BTreeMap<String, String>,
    event: &str,
    fields: Option<&Map<String, Value>>,
) -> bool {
    write_debug_log_event_result(env, event, fields).is_ok()
}

pub fn write_debug_log_event_result(
    env: &BTreeMap<String, String>,
    event: &str,
    fields: Option<&Map<String, Value>>,
) -> std::io::Result<()> {
    let log_path = resolve_debug_log_path_from_env(env);
    ensure_parent_dir(&log_path)?;

    let mut entry = Map::new();
    entry.insert("timestamp".to_string(), Value::String(current_timestamp()));
    entry.insert("event".to_string(), Value::String(event.trim().to_string()));

    for (key, value) in sanitize_fields(fields) {
        entry.insert(key, value);
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    writeln!(file, "{}", Value::Object(entry))?;
    Ok(())
}

pub fn log_debug_event(env: &BTreeMap<String, String>, enabled: bool, event: &str, fields: Value) {
    if !enabled {
        return;
    }

    let fields = fields.as_object();
    let _ = write_debug_log_event_result(env, event, fields);
}

fn ensure_parent_dir(path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn sanitize_fields(fields: Option<&Map<String, Value>>) -> Vec<(String, Value)> {
    let Some(fields) = fields else {
        return Vec::new();
    };

    fields
        .iter()
        .filter(|(key, value)| {
            !key.is_empty() && key.len() <= MAX_FIELD_KEY_LEN && is_allowed_field_value(value)
        })
        .take(MAX_FIELD_COUNT)
        .map(|(key, value)| {
            let value = match value {
                Value::String(value) => Value::String(summarize_log_message(value)),
                _ => value.clone(),
            };
            (key.clone(), value)
        })
        .collect()
}

fn is_allowed_field_value(value: &Value) -> bool {
    matches!(
        value,
        Value::String(_) | Value::Number(_) | Value::Bool(_) | Value::Null
    )
}

fn summarize_log_message(message: &str) -> String {
    let mut summarized = message.split_whitespace().collect::<Vec<_>>().join(" ");
    if summarized.len() > MAX_FIELD_STRING_LEN {
        summarized.truncate(MAX_FIELD_STRING_LEN);
    }
    summarized
}

fn current_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    json!(millis).to_string()
}
