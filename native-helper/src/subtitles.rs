use serde::{Deserialize, Serialize};

use crate::process::ProviderError;

pub const SUBTITLE_TRANSLATION_PROMPT_VERSION: u64 = 1;
pub const SUBTITLE_CHUNK_MAX_CUES: usize = 80;
pub const SUBTITLE_CHUNK_MAX_SOURCE_CHARS: usize = 6000;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleCue {
    pub id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslatedSubtitleCue {
    pub id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub translated_text: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubtitleChunk {
    pub index: usize,
    pub cues: Vec<SubtitleCue>,
}

pub fn plan_subtitle_chunks(cues: &[SubtitleCue]) -> Vec<SubtitleChunk> {
    let mut chunks = Vec::new();
    let mut current = Vec::new();
    let mut current_chars = 0_usize;

    for cue in cues.iter().cloned() {
        let cue_chars = cue.text.chars().count();
        let exceeds_count = current.len() >= SUBTITLE_CHUNK_MAX_CUES;
        let exceeds_chars =
            !current.is_empty() && current_chars + cue_chars > SUBTITLE_CHUNK_MAX_SOURCE_CHARS;

        if exceeds_count || exceeds_chars {
            chunks.push(SubtitleChunk {
                index: chunks.len(),
                cues: std::mem::take(&mut current),
            });
            current_chars = 0;
        }

        current_chars += cue_chars;
        current.push(cue);
    }

    if !current.is_empty() {
        chunks.push(SubtitleChunk {
            index: chunks.len(),
            cues: current,
        });
    }

    chunks
}

pub fn build_subtitle_translation_prompt(cues: &[SubtitleCue], target_lang: &str) -> String {
    let cue_input = cues
        .iter()
        .map(|cue| serde_json::json!({"id": cue.id, "text": cue.text}))
        .collect::<Vec<_>>();

    [
        format!("Translate each subtitle cue to {target_lang}."),
        "Return valid JSON only.".to_string(),
        "Use this exact shape: {\"cues\":[{\"id\":\"cue-id\",\"translatedText\":\"translated text\"}]}.".to_string(),
        "Preserve cue ids exactly.".to_string(),
        "Do not merge, split, drop, or reorder cues.".to_string(),
        "Do not include markdown fences.".to_string(),
        "Preserve names, numbers, product names, and on-screen terminology.".to_string(),
        String::new(),
        "Cues:".to_string(),
        serde_json::to_string(&serde_json::json!({ "cues": cue_input }))
            .unwrap_or_else(|_| "{\"cues\":[]}".to_string()),
    ]
    .join("\n")
}

pub fn validate_subtitle_translation_output(
    source: &[SubtitleCue],
    output: &str,
) -> Result<Vec<TranslatedSubtitleCue>, ProviderError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct OutputCue {
        id: String,
        translated_text: String,
    }

    #[derive(Deserialize)]
    struct Output {
        cues: Vec<OutputCue>,
    }

    let parsed = serde_json::from_str::<Output>(output).map_err(|error| {
        ProviderError::OutputParseFailed {
            message: error.to_string(),
        }
    })?;

    if parsed.cues.len() != source.len() {
        return Err(ProviderError::OutputParseFailed {
            message: "Subtitle output cue count did not match source cue count.".to_string(),
        });
    }

    source
        .iter()
        .zip(parsed.cues)
        .map(|(source, translated)| {
            if translated.id != source.id || translated.translated_text.trim().is_empty() {
                return Err(ProviderError::OutputParseFailed {
                    message: "Subtitle output cue ids or text were invalid.".to_string(),
                });
            }

            Ok(TranslatedSubtitleCue {
                id: source.id.clone(),
                start_ms: source.start_ms,
                end_ms: source.end_ms,
                translated_text: translated.translated_text.trim().to_string(),
            })
        })
        .collect()
}
