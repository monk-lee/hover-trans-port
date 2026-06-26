use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const NATIVE_BRIDGE_VERSION: &str = "0.2.17-rust-helper";
pub const NATIVE_HOST_VERSION: &str = "0.2.17";
pub const NATIVE_HOST_PROTOCOL_VERSION: u64 = 3;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Codex,
    Claude,
    Gemini,
    Opencode,
    Antigravity,
}

impl ProviderId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Gemini => "gemini",
            Self::Opencode => "opencode",
            Self::Antigravity => "antigravity",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatusEntry {
    pub id: ProviderId,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binary_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatusRequest {
    pub provider: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseRequest {
    #[serde(rename = "type")]
    pub message_type: Option<String>,
    pub request_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateRequest {
    pub request_id: String,
    pub text: String,
    pub target_lang: String,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub source_lang: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub cache_enabled: Option<bool>,
    #[serde(default)]
    pub debug_logging: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleCacheRequest {
    pub request_id: String,
    pub target_lang: String,
    pub video_id: String,
    pub source_track_identity: String,
    pub source_timeline_hash: String,
    pub prompt_version: u64,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateSubtitlesRequest {
    pub request_id: String,
    pub target_lang: String,
    pub video_id: String,
    pub source_track_identity: String,
    pub source_timeline_hash: String,
    pub prompt_version: u64,
    pub cues: Vec<crate::subtitles::SubtitleCue>,
    #[serde(default)]
    pub context_before: Option<Vec<crate::subtitles::SubtitleCue>>,
    #[serde(default)]
    pub context_after: Option<Vec<crate::subtitles::SubtitleCue>>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub cache_enabled: Option<bool>,
    #[serde(default)]
    pub debug_logging: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleCacheWriteRequest {
    pub request_id: String,
    pub target_lang: String,
    pub video_id: String,
    pub source_track_identity: String,
    pub source_timeline_hash: String,
    pub prompt_version: u64,
    pub source_cues: Vec<crate::subtitles::SubtitleCue>,
    pub translated_cues: Vec<crate::subtitles::TranslatedSubtitleCue>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelsRequest {
    pub request_id: String,
    #[serde(default)]
    pub provider: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHostUpdateRequest {
    pub request_id: String,
    pub target_tag: String,
    pub target_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugLogContentRequest {
    pub request_id: String,
    #[serde(default)]
    pub max_bytes: Option<u64>,
    #[serde(default)]
    pub max_lines: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugLogWriteRequest {
    pub request_id: String,
    pub event: String,
    #[serde(default)]
    pub fields: Option<Map<String, Value>>,
}
