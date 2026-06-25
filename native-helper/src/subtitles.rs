use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use crate::process::ProviderError;

pub const SUBTITLE_TRANSLATION_PROMPT_VERSION: u64 = 1;
pub const SUBTITLE_CHUNK_SEGMENT_DURATION_MS: u64 = 60_000;
pub const SUBTITLE_CHUNK_CONTEXT_CUES: usize = 5;
const SUBTITLE_TARGET_LENGTH_RATIO_LIMIT: usize = 4;
const SUBTITLE_TARGET_LENGTH_MIN_LIMIT: usize = 80;
const PROTECTED_TERMS: &[&str] = &[
    "React Native",
    "Expo UI",
    "Expo",
    "SwiftUI",
    "Jetpack Compose",
    "Xcode",
    "Android Studio",
    "Google I/O",
    "WWDC",
    "iOS",
    "AI",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SubtitleOutputValidationMode {
    Strict,
    AllowQualityIssues,
}

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

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleQualityIssue {
    pub id: String,
    pub reason: String,
    pub message: String,
}

pub fn plan_subtitle_chunks(cues: &[SubtitleCue]) -> Vec<SubtitleChunk> {
    let mut chunks = Vec::new();
    let mut current_start = 0_usize;
    let mut current_len = 0_usize;
    let mut current_segment_index = None;

    for (index, cue) in cues.iter().enumerate() {
        let cue_segment_index = cue.start_ms / SUBTITLE_CHUNK_SEGMENT_DURATION_MS;

        if current_len > 0 && current_segment_index != Some(cue_segment_index) {
            chunks.push(create_subtitle_chunk(
                chunks.len(),
                cues,
                current_start,
                index,
            ));
            current_start = index;
            current_len = 0;
        }

        if current_len == 0 {
            current_segment_index = Some(cue_segment_index);
        }

        current_len += 1;
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
    let expected_cue_ids = chunk
        .cues
        .iter()
        .map(|cue| cue.id.as_str())
        .collect::<Vec<_>>();

    [
        format!("Translate YouTube subtitle cues into {target_lang}."),
        format!("Translate the subtitle timeline into natural, concise {target_lang}."),
        format!("Use a natural, respectful subtitle style appropriate for {target_lang}."),
        "Avoid overly casual slang unless the source clearly requires it.".to_string(),
        "Do not introduce first-person pronouns unless the source sentence explicitly contains first-person meaning.".to_string(),
        "Keep protected technical names exactly as written when they appear in the source.".to_string(),
        "Timing alignment is more important than making each cue standalone.".to_string(),
        "When neighboring cues form one source sentence, plan the surrounding sentence meaning first.".to_string(),
        "Split that translated sentence into subtitle fragments that match each source cue's role in the timeline.".to_string(),
        format!("It is okay for {target_lang} grammar to distribute meaning across neighboring cue fragments, as long as the contiguous sentence meaning stays complete and in order."),
        "Keep fragment length balanced for the cue duration; do not pack a whole neighboring sentence into one short cue when the next cue can carry the continuation.".to_string(),
        "Do not force every fragment to be a complete sentence.".to_string(),
        format!("Fragments may end with {target_lang} particles, connective endings, or equivalent sentence-flow markers when that reads naturally."),
        "Use contextBefore and contextAfter only to choose meaning, terminology, pronouns, speaker intent, and tone.".to_string(),
        "Do not translate contextBefore or contextAfter; within cuesToTranslate, preserve the same id order and distribute the translated sentence across those cue ids by timing.".to_string(),
        "Do not borrow words from context cues to complete cuesToTranslate.".to_string(),
        "contextBefore and contextAfter are reference context only; translate cuesToTranslate only.".to_string(),
        "Do not output ids from contextBefore or contextAfter.".to_string(),
        format!(
            "Return exactly {} cues, using only expectedCueIds in the same order.",
            expected_cue_ids.len()
        ),
        "Return valid JSON only.".to_string(),
        "Use this exact shape: {\"cues\":[{\"id\":\"cue-id\",\"translatedText\":\"translated text\"}]}.".to_string(),
        "Preserve cue ids exactly.".to_string(),
        "Do not merge, split, drop, or reorder cues.".to_string(),
        "Do not include markdown fences.".to_string(),
        "Preserve names, numbers, product names, and on-screen terminology; translate repeated terms consistently.".to_string(),
        format!("Do not overfit word-by-word source cue boundaries; {target_lang} grammar and sentence flow may place particles, endings, short predicates, or equivalent connective text in a neighboring fragment when that reads better."),
        "Natural subtitle examples:".to_string(),
        "Source fragments: “I chose this approach / because it works in both places”.".to_string(),
        "Target fragments: “I chose this approach [natural target-language setup] / because it works in both places [natural target-language continuation]”.".to_string(),
        "Source fragments: “if you want to learn more / check the next section”.".to_string(),
        "Target fragments: “if you want to learn more [natural target-language setup] / check the next section [natural target-language continuation]”.".to_string(),
        "Avoid repeating the same target fragment across adjacent cues unless the source repeats it.".to_string(),
        String::new(),
        "Input JSON:".to_string(),
        serde_json::to_string(&serde_json::json!({
            "contextBefore": context_before,
            "cuesToTranslate": cues_to_translate,
            "contextAfter": context_after,
            "expectedCueIds": expected_cue_ids
        }))
        .unwrap_or_else(|_| {
            "{\"contextBefore\":[],\"cuesToTranslate\":[],\"contextAfter\":[]}".to_string()
        }),
    ]
    .join("\n")
}

pub fn build_subtitle_repair_prompt(
    chunk: &SubtitleChunk,
    current_translations: &[TranslatedSubtitleCue],
    quality_issues: &[SubtitleQualityIssue],
    target_lang: &str,
) -> String {
    let context_before = prompt_cue_input(&chunk.context_before);
    let cues_to_translate = prompt_cue_input(&chunk.cues);
    let context_after = prompt_cue_input(&chunk.context_after);
    let current_translations = prompt_translation_input(current_translations);
    let expected_cue_ids = chunk
        .cues
        .iter()
        .map(|cue| cue.id.as_str())
        .collect::<Vec<_>>();

    [
        format!("Repair YouTube subtitle cue translations into {target_lang}."),
        "The current translations have structural, naturalness, tone, terminology, repetition, length, or timeline-alignment quality issues.".to_string(),
        format!("Repair neighboring target cues so the joined {target_lang} subtitle text reads naturally while each cue stays concise and preserves its timed role."),
        format!("Use a natural, respectful subtitle style appropriate for {target_lang}."),
        "Avoid overly casual slang unless the source clearly requires it.".to_string(),
        "Do not introduce first-person pronouns unless the source sentence explicitly contains first-person meaning.".to_string(),
        "Keep protected technical names exactly as written when they appear in the source.".to_string(),
        "Timing alignment is more important than making each cue standalone.".to_string(),
        "When neighboring cues form one source sentence, plan the surrounding sentence meaning first.".to_string(),
        "Split that translated sentence into subtitle fragments that match each source cue's role in the timeline.".to_string(),
        format!("It is okay for {target_lang} grammar to distribute meaning across neighboring cue fragments, as long as the contiguous sentence meaning stays complete and in order."),
        "Keep fragment length balanced for the cue duration; do not pack a whole neighboring sentence into one short cue when the next cue can carry the continuation.".to_string(),
        "Do not force every fragment to be a complete sentence.".to_string(),
        format!("Fragments may end with {target_lang} particles, connective endings, or equivalent sentence-flow markers when that reads naturally."),
        "Do not translate contextBefore or contextAfter; within cuesToTranslate, preserve the same id order and distribute the translated sentence across those cue ids by timing.".to_string(),
        format!("Do not overfit word-by-word source cue boundaries; {target_lang} grammar and sentence flow may place particles, endings, short predicates, or equivalent connective text in a neighboring fragment when that reads better."),
        "Natural subtitle examples:".to_string(),
        "Source fragments: “I chose this approach / because it works in both places”.".to_string(),
        "Target fragments: “I chose this approach [natural target-language setup] / because it works in both places [natural target-language continuation]”.".to_string(),
        "Source fragments: “if you want to learn more / check the next section”.".to_string(),
        "Target fragments: “if you want to learn more [natural target-language setup] / check the next section [natural target-language continuation]”.".to_string(),
        "Avoid repeating the same target fragment across adjacent cues unless the source repeats it.".to_string(),
        "Use contextBefore and contextAfter only to choose meaning, terminology, pronouns, speaker intent, and tone.".to_string(),
        "Return valid JSON only.".to_string(),
        "Use this exact shape: {\"cues\":[{\"id\":\"cue-id\",\"translatedText\":\"translated text\"}]}.".to_string(),
        format!(
            "Return exactly {} cues, using only expectedCueIds in the same order.",
            expected_cue_ids.len()
        ),
        "Preserve cue ids exactly.".to_string(),
        "Do not merge, split, drop, or reorder cues.".to_string(),
        "Do not include markdown fences.".to_string(),
        String::new(),
        "Input JSON:".to_string(),
        serde_json::to_string(&serde_json::json!({
            "contextBefore": context_before,
            "cuesToTranslate": cues_to_translate,
            "currentTranslations": current_translations,
            "qualityIssues": quality_issues,
            "contextAfter": context_after,
            "expectedCueIds": expected_cue_ids
        }))
        .unwrap_or_else(|_| {
            "{\"contextBefore\":[],\"cuesToTranslate\":[],\"currentTranslations\":[],\"qualityIssues\":[],\"contextAfter\":[]}".to_string()
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

fn prompt_translation_input(cues: &[TranslatedSubtitleCue]) -> Vec<serde_json::Value> {
    cues.iter()
        .map(|cue| {
            serde_json::json!({
                "id": cue.id,
                "startMs": cue.start_ms,
                "endMs": cue.end_ms,
                "translatedText": cue.translated_text
            })
        })
        .collect::<Vec<_>>()
}

pub fn validate_subtitle_translation_output(
    source: &[SubtitleCue],
    output: &str,
) -> Result<Vec<TranslatedSubtitleCue>, ProviderError> {
    parse_subtitle_translation_output(source, output, SubtitleOutputValidationMode::Strict)
}

pub fn parse_subtitle_translation_output_allowing_quality_issues(
    source: &[SubtitleCue],
    output: &str,
) -> Result<Vec<TranslatedSubtitleCue>, ProviderError> {
    parse_subtitle_translation_output(
        source,
        output,
        SubtitleOutputValidationMode::AllowQualityIssues,
    )
}

fn parse_subtitle_translation_output(
    source: &[SubtitleCue],
    output: &str,
    mode: SubtitleOutputValidationMode,
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

    let source_ids = source.iter().map(|cue| cue.id.as_str()).collect::<Vec<_>>();
    let mut translated_by_id = HashMap::<String, String>::new();

    for cue in parsed.cues {
        if !source_ids.contains(&cue.id.as_str()) {
            continue;
        }

        let translated_text = cue.translated_text.trim().to_string();

        if translated_text.is_empty() || translated_by_id.insert(cue.id, translated_text).is_some()
        {
            return Err(ProviderError::OutputParseFailed {
                message: "Subtitle output target cue ids or text were invalid.".to_string(),
            });
        }
    }

    source
        .iter()
        .map(|source| {
            translated_by_id
                .remove(&source.id)
                .map(|translated_text| {
                    if mode == SubtitleOutputValidationMode::Strict
                        && target_text_is_implausibly_long(source, &translated_text)
                    {
                        return Err(ProviderError::OutputParseFailed {
                            message: "Subtitle output target cue text was implausibly long."
                                .to_string(),
                        });
                    }

                    Ok(TranslatedSubtitleCue {
                        id: source.id.clone(),
                        start_ms: source.start_ms,
                        end_ms: source.end_ms,
                        translated_text,
                    })
                })
                .ok_or_else(|| ProviderError::OutputParseFailed {
                    message: "Subtitle output target cue count did not match source cue count."
                        .to_string(),
                })?
        })
        .collect()
}

pub fn audit_subtitle_translation_quality(
    source: &[SubtitleCue],
    translated: &[TranslatedSubtitleCue],
) -> Vec<SubtitleQualityIssue> {
    let translated_by_id = translated
        .iter()
        .map(|cue| (cue.id.as_str(), cue))
        .collect::<HashMap<_, _>>();
    let mut issues = Vec::new();

    for (index, cue) in source.iter().enumerate() {
        let Some(translated) = translated_by_id.get(cue.id.as_str()) else {
            continue;
        };
        let source_terms = protected_terms_in_text(&cue.text);
        let target_terms = protected_terms_in_text(&translated.translated_text);
        let source_window_terms = protected_terms_in_source_window(source, index);
        let target_window_terms =
            protected_terms_in_translated_window(source, &translated_by_id, index);

        if target_text_is_implausibly_long(cue, &translated.translated_text) {
            issues.push(SubtitleQualityIssue {
                id: cue.id.clone(),
                reason: "implausiblyLongTargetCue".to_string(),
                message: "Target cue is too long for the source cue and may contain neighboring subtitle content.".to_string(),
            });
        }

        for term in target_terms.difference(&source_window_terms) {
            if protected_term_allowed_by_source_window_fragment(source, index, term) {
                continue;
            }

            issues.push(SubtitleQualityIssue {
                id: cue.id.clone(),
                reason: "borrowedProtectedTerm".to_string(),
                message: format!(
                    "Target cue contains protected term '{term}' that is not present in the nearby source timeline."
                ),
            });
        }

        for term in source_terms.difference(&target_window_terms) {
            issues.push(SubtitleQualityIssue {
                id: cue.id.clone(),
                reason: "missingProtectedTerm".to_string(),
                message: format!(
                    "Source cue contains protected term '{term}' but nearby target cues do not preserve it."
                ),
            });
        }

        if translated_text_duplicates_adjacent_translation(source, &translated_by_id, index) {
            if let Some(previous_source) = source.get(index.saturating_sub(1)) {
                issues.push(SubtitleQualityIssue {
                    id: previous_source.id.clone(),
                    reason: "duplicatedAdjacentTranslation".to_string(),
                    message: "Adjacent target cues repeat the same translation even though the source cues differ.".to_string(),
                });
            }
            issues.push(SubtitleQualityIssue {
                id: cue.id.clone(),
                reason: "duplicatedAdjacentTranslation".to_string(),
                message: "Adjacent target cues repeat the same translation even though the source cues differ.".to_string(),
            });
        }
    }

    let mut seen_issues = HashSet::new();
    issues.retain(|issue| seen_issues.insert((issue.id.clone(), issue.reason.clone())));

    issues
}

pub fn summarize_subtitle_quality_issues(issues: &[SubtitleQualityIssue]) -> String {
    issues
        .iter()
        .take(5)
        .map(|issue| format!("{}:{}", issue.id, issue.reason))
        .collect::<Vec<_>>()
        .join(", ")
}

pub fn create_subtitle_quality_repair_chunk(
    chunk: &SubtitleChunk,
    issues: &[SubtitleQualityIssue],
) -> Option<SubtitleChunk> {
    let issue_ids = issues
        .iter()
        .map(|issue| issue.id.as_str())
        .collect::<HashSet<_>>();
    let issue_positions = chunk
        .cues
        .iter()
        .enumerate()
        .filter_map(|(index, cue)| issue_ids.contains(cue.id.as_str()).then_some(index))
        .collect::<Vec<_>>();
    let first = issue_positions.iter().min().copied()?;
    let last = issue_positions.iter().max().copied()?;
    let repair_end = last + 1;

    let mut context_before = Vec::new();
    let parent_context_count = SUBTITLE_CHUNK_CONTEXT_CUES.saturating_sub(first);
    if parent_context_count > 0 {
        let parent_context_start = chunk
            .context_before
            .len()
            .saturating_sub(parent_context_count);
        context_before.extend_from_slice(&chunk.context_before[parent_context_start..]);
    }
    let chunk_context_start = first.saturating_sub(SUBTITLE_CHUNK_CONTEXT_CUES);
    context_before.extend_from_slice(&chunk.cues[chunk_context_start..first]);

    let mut context_after = chunk.cues
        [repair_end..(repair_end + SUBTITLE_CHUNK_CONTEXT_CUES).min(chunk.cues.len())]
        .to_vec();
    let parent_after_count = SUBTITLE_CHUNK_CONTEXT_CUES.saturating_sub(context_after.len());
    if parent_after_count > 0 {
        context_after.extend_from_slice(
            &chunk.context_after[..parent_after_count.min(chunk.context_after.len())],
        );
    }

    Some(SubtitleChunk {
        index: chunk.index,
        cues: chunk.cues[first..repair_end].to_vec(),
        context_before,
        context_after,
    })
}

fn target_text_is_implausibly_long(source: &SubtitleCue, translated_text: &str) -> bool {
    let source_chars = source.text.chars().count();
    let translated_chars = translated_text.chars().count();
    let source_based_limit =
        SUBTITLE_TARGET_LENGTH_MIN_LIMIT.max(source_chars * SUBTITLE_TARGET_LENGTH_RATIO_LIMIT);
    let duration_based_limit = subtitle_duration_target_length_limit(source);
    let max_target_chars = source_based_limit.min(duration_based_limit);

    translated_chars > max_target_chars
}

fn subtitle_duration_target_length_limit(source: &SubtitleCue) -> usize {
    let duration_ms = source.end_ms.saturating_sub(source.start_ms);

    match duration_ms {
        0..=1_500 => 48,
        1_501..=2_500 => 60,
        2_501..=4_000 => 80,
        4_001..=6_000 => 110,
        _ => 140,
    }
}

fn protected_terms_in_text(text: &str) -> HashSet<&'static str> {
    PROTECTED_TERMS
        .iter()
        .copied()
        .filter(|term| contains_protected_term(text, term))
        .collect::<HashSet<_>>()
}

fn protected_terms_in_source_window(source: &[SubtitleCue], index: usize) -> HashSet<&'static str> {
    let start = index.saturating_sub(1);
    let end = (index + 2).min(source.len());

    source[start..end]
        .iter()
        .flat_map(|cue| protected_terms_in_text(&cue.text))
        .collect::<HashSet<_>>()
}

fn protected_terms_in_translated_window<'a>(
    source: &[SubtitleCue],
    translated_by_id: &HashMap<&str, &'a TranslatedSubtitleCue>,
    index: usize,
) -> HashSet<&'static str> {
    let start = index.saturating_sub(1);
    let end = (index + 2).min(source.len());

    source[start..end]
        .iter()
        .filter_map(|cue| translated_by_id.get(cue.id.as_str()))
        .flat_map(|cue| protected_terms_in_text(&cue.translated_text))
        .collect::<HashSet<_>>()
}

fn protected_term_allowed_by_source_window_fragment(
    source: &[SubtitleCue],
    index: usize,
    term: &str,
) -> bool {
    let start = index.saturating_sub(1);
    let end = (index + 2).min(source.len());
    let source_text = source[start..end]
        .iter()
        .map(|cue| cue.text.as_str())
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();

    if term == "React Native" {
        return contains_protected_term(&source_text, "React")
            || contains_protected_term(&source_text, "Native");
    }

    term == "AI" && (contains_protected_term(&source_text, "this") || source_text.contains("era"))
}

fn contains_protected_term(text: &str, term: &str) -> bool {
    let text = text.to_lowercase();
    let term = term.to_lowercase();
    let mut offset = 0_usize;

    while let Some(relative_start) = text[offset..].find(&term) {
        let start = offset + relative_start;
        let end = start + term.len();

        if is_term_boundary(&text, start, end) {
            return true;
        }

        offset = end;
    }

    false
}

fn is_term_boundary(text: &str, start: usize, end: usize) -> bool {
    let before = text[..start].chars().next_back();
    let after = text[end..].chars().next();

    before.is_none_or(|character| !character.is_ascii_alphanumeric())
        && after.is_none_or(|character| !character.is_ascii_alphanumeric())
}

fn translated_text_duplicates_adjacent_translation(
    source: &[SubtitleCue],
    translated_by_id: &HashMap<&str, &TranslatedSubtitleCue>,
    index: usize,
) -> bool {
    if index == 0 {
        return false;
    }

    let Some(previous_source) = source.get(index - 1) else {
        return false;
    };
    let Some(current_source) = source.get(index) else {
        return false;
    };
    let Some(previous) = translated_by_id.get(previous_source.id.as_str()) else {
        return false;
    };
    let Some(current) = translated_by_id.get(current_source.id.as_str()) else {
        return false;
    };

    let previous_source_text = normalize_subtitle_comparison_fragment(&previous_source.text);
    let current_source_text = normalize_subtitle_comparison_fragment(&current_source.text);
    if previous_source_text == current_source_text {
        return false;
    }

    let previous_text = normalize_subtitle_comparison_fragment(&previous.translated_text);
    let current_text = normalize_subtitle_comparison_fragment(&current.translated_text);

    previous_text.chars().count() >= 8 && previous_text == current_text
}

fn normalize_subtitle_comparison_fragment(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .filter(|character| {
            !character.is_whitespace()
                && !matches!(
                    character,
                    '.' | ','
                        | '?'
                        | '!'
                        | ':'
                        | ';'
                        | '"'
                        | '\''
                        | '“'
                        | '”'
                        | '('
                        | ')'
                        | '['
                        | ']'
                        | '…'
                        | '。'
                        | '，'
                        | '？'
                        | '！'
                )
        })
        .collect()
}
