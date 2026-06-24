use serde::{Deserialize, Serialize};

use crate::process::ProviderError;

pub const SUBTITLE_TRANSLATION_PROMPT_VERSION: u64 = 2;
pub const SUBTITLE_CHUNK_MAX_CUES: usize = 80;
pub const SUBTITLE_CHUNK_MAX_SOURCE_CHARS: usize = 6000;
pub const SUBTITLE_CHUNK_CONTEXT_CUES: usize = 8;

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
    pub context_before: Vec<SubtitleCue>,
    pub context_after: Vec<SubtitleCue>,
}

pub fn plan_subtitle_chunks(cues: &[SubtitleCue]) -> Vec<SubtitleChunk> {
    let mut chunks = Vec::new();
    let mut current_start = 0_usize;
    let mut current_len = 0_usize;
    let mut current_chars = 0_usize;

    for (index, cue) in cues.iter().enumerate() {
        let cue_chars = cue.text.chars().count();
        let exceeds_count = current_len >= SUBTITLE_CHUNK_MAX_CUES;
        let exceeds_chars =
            current_len > 0 && current_chars + cue_chars > SUBTITLE_CHUNK_MAX_SOURCE_CHARS;

        if exceeds_count || exceeds_chars {
            chunks.push(create_subtitle_chunk(
                chunks.len(),
                cues,
                current_start,
                index,
            ));
            current_start = index;
            current_len = 0;
            current_chars = 0;
        }

        current_len += 1;
        current_chars += cue_chars;
    }

    if current_len > 0 {
        chunks.push(create_subtitle_chunk(
            chunks.len(),
            cues,
            current_start,
            cues.len(),
        ));
    }

    chunks
}

fn create_subtitle_chunk(
    index: usize,
    cues: &[SubtitleCue],
    start: usize,
    end: usize,
) -> SubtitleChunk {
    let context_before_start = start.saturating_sub(SUBTITLE_CHUNK_CONTEXT_CUES);
    let context_after_end = cues.len().min(end + SUBTITLE_CHUNK_CONTEXT_CUES);

    SubtitleChunk {
        index,
        cues: cues[start..end].to_vec(),
        context_before: cues[context_before_start..start].to_vec(),
        context_after: cues[end..context_after_end].to_vec(),
    }
}

pub fn build_subtitle_translation_prompt(chunk: &SubtitleChunk, target_lang: &str) -> String {
    let context_before = prompt_cue_input(&chunk.context_before);
    let cues_to_translate = prompt_cue_input(&chunk.cues);
    let context_after = prompt_cue_input(&chunk.context_after);

    [
        format!("Translate YouTube subtitle cues into {target_lang}."),
        format!("Write natural subtitle-style {target_lang}: concise, conversational, and easy to understand while watching video."),
        "Use surrounding context to resolve pronouns, omitted subjects, terminology, speaker intent, and tone.".to_string(),
        "When a sentence spans multiple cues, translate each cue fragment so the full sequence reads naturally while preserving cue boundaries.".to_string(),
        "contextBefore and contextAfter are reference context only; translate cuesToTranslate only.".to_string(),
        "Return valid JSON only.".to_string(),
        "Use this exact shape: {\"cues\":[{\"id\":\"cue-id\",\"translatedText\":\"translated text\"}]}.".to_string(),
        "Preserve cue ids exactly.".to_string(),
        "Do not merge, split, drop, or reorder cues.".to_string(),
        "Do not include markdown fences.".to_string(),
        "Preserve names, numbers, product names, and on-screen terminology; translate repeated terms consistently.".to_string(),
        String::new(),
        "Input JSON:".to_string(),
        serde_json::to_string(&serde_json::json!({
            "contextBefore": context_before,
            "cuesToTranslate": cues_to_translate,
            "contextAfter": context_after
        }))
        .unwrap_or_else(|_| {
            "{\"contextBefore\":[],\"cuesToTranslate\":[],\"contextAfter\":[]}".to_string()
        }),
    ]
    .join("\n")
}

fn prompt_cue_input(cues: &[SubtitleCue]) -> Vec<serde_json::Value> {
    cues.iter()
        .map(|cue| {
            serde_json::json!({
                "id": cue.id,
                "startMs": cue.start_ms,
                "endMs": cue.end_ms,
                "text": cue.text
            })
        })
        .collect::<Vec<_>>()
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
