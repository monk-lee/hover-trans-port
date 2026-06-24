use hover_trans_port_helper::subtitles::{
    build_subtitle_translation_prompt, plan_subtitle_chunks, validate_subtitle_translation_output,
    SubtitleCue, SUBTITLE_TRANSLATION_PROMPT_VERSION,
};

#[test]
fn chunk_plan_respects_count_and_character_limits() {
    let cues = (0..81)
        .map(|index| SubtitleCue {
            id: format!("cue-{index}"),
            start_ms: index * 1000,
            end_ms: index * 1000 + 800,
            text: "short cue".to_string(),
        })
        .collect::<Vec<_>>();

    let chunks = plan_subtitle_chunks(&cues);
    assert_eq!(chunks.len(), 2);
    assert_eq!(chunks[0].cues.len(), 80);
    assert_eq!(chunks[1].cues.len(), 1);
    assert_eq!(chunks[0].context_after[0].id, "cue-80");
    assert_eq!(chunks[1].context_before.len(), 8);
    assert_eq!(chunks[1].context_before[0].id, "cue-72");
}

#[test]
fn subtitle_prompt_version_invalidates_older_cache_entries() {
    assert_eq!(SUBTITLE_TRANSLATION_PROMPT_VERSION, 2);
}

#[test]
fn prompt_uses_surrounding_context_without_requesting_context_output() {
    let cues = (0..170)
        .map(|index| SubtitleCue {
            id: format!("cue-{index}"),
            start_ms: index * 1000,
            end_ms: index * 1000 + 800,
            text: format!("line {index}"),
        })
        .collect::<Vec<_>>();
    let chunks = plan_subtitle_chunks(&cues);
    let prompt = build_subtitle_translation_prompt(&chunks[1], "Korean");

    assert!(prompt.contains("Return valid JSON only."));
    assert!(prompt.contains("cuesToTranslate"));
    assert!(prompt.contains("contextBefore"));
    assert!(prompt.contains("contextAfter"));
    assert!(prompt.contains("cue-79"));
    assert!(prompt.contains("cue-80"));
    assert!(prompt.contains("cue-160"));
    assert!(prompt.contains("contextBefore and contextAfter are reference context only"));
    assert!(prompt.contains("natural subtitle-style Korean"));
    assert!(prompt.contains("Do not merge, split, drop, or reorder cues."));
}

#[test]
fn prompt_preserves_output_shape_and_target_ids() {
    let chunks = plan_subtitle_chunks(&[SubtitleCue {
        id: "cue-1".to_string(),
        start_ms: 0,
        end_ms: 1000,
        text: "Hello".to_string(),
    }]);
    let prompt = build_subtitle_translation_prompt(&chunks[0], "Korean");

    assert!(prompt.contains("Return valid JSON only."));
    assert!(prompt.contains("cue-1"));
    assert!(prompt.contains("Do not merge, split, drop, or reorder cues."));
}

#[test]
fn validation_rejects_missing_duplicate_or_reordered_cues() {
    let source = vec![
        SubtitleCue {
            id: "a".to_string(),
            start_ms: 0,
            end_ms: 1000,
            text: "Hello".to_string(),
        },
        SubtitleCue {
            id: "b".to_string(),
            start_ms: 1000,
            end_ms: 2000,
            text: "Bye".to_string(),
        },
    ];

    let ok = validate_subtitle_translation_output(
        &source,
        r#"{"cues":[{"id":"a","translatedText":"안녕"},{"id":"b","translatedText":"잘 가"}]}"#,
    )
    .unwrap();
    assert_eq!(ok[0].translated_text, "안녕");

    assert!(validate_subtitle_translation_output(
        &source,
        r#"{"cues":[{"id":"a","translatedText":"안녕"}]}"#
    )
    .is_err());
    assert!(validate_subtitle_translation_output(
        &source,
        r#"{"cues":[{"id":"b","translatedText":"잘 가"},{"id":"a","translatedText":"안녕"}]}"#
    )
    .is_err());
}
