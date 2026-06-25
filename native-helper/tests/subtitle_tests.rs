use hover_trans_port_helper::subtitles::{
    audit_subtitle_translation_quality, build_subtitle_repair_prompt,
    build_subtitle_translation_prompt, plan_subtitle_chunks, validate_subtitle_translation_output,
    SubtitleCue, TranslatedSubtitleCue, SUBTITLE_CHUNK_SEGMENT_DURATION_MS,
    SUBTITLE_TRANSLATION_PROMPT_VERSION,
};

#[test]
fn chunk_plan_uses_fixed_one_minute_segments_without_count_or_character_limits() {
    let dense_cues = (0..81)
        .map(|index| SubtitleCue {
            id: format!("cue-{index}"),
            start_ms: index * 700,
            end_ms: index * 700 + 500,
            text: "short cue".to_string(),
        })
        .collect::<Vec<_>>();

    let dense_chunks = plan_subtitle_chunks(&dense_cues);
    assert_eq!(SUBTITLE_CHUNK_SEGMENT_DURATION_MS, 60_000);
    assert_eq!(dense_chunks.len(), 1);
    assert_eq!(dense_chunks[0].cues.len(), 81);

    let boundary_cues = vec![
        SubtitleCue {
            id: "cue-0".to_string(),
            start_ms: 0,
            end_ms: 800,
            text: "first segment".to_string(),
        },
        SubtitleCue {
            id: "cue-1".to_string(),
            start_ms: 59_000,
            end_ms: 59_800,
            text: "still first segment".to_string(),
        },
        SubtitleCue {
            id: "cue-2".to_string(),
            start_ms: 60_000,
            end_ms: 60_800,
            text: "second segment".to_string(),
        },
        SubtitleCue {
            id: "cue-3".to_string(),
            start_ms: 119_000,
            end_ms: 119_800,
            text: "still second segment".to_string(),
        },
        SubtitleCue {
            id: "cue-4".to_string(),
            start_ms: 120_000,
            end_ms: 120_800,
            text: "third segment".to_string(),
        },
    ];

    let chunks = plan_subtitle_chunks(&boundary_cues);
    assert_eq!(chunks.len(), 3);
    assert_eq!(chunks[0].cues.len(), 2);
    assert_eq!(chunks[1].cues.len(), 2);
    assert_eq!(chunks[2].cues.len(), 1);
    assert_eq!(chunks[0].context_after[0].id, "cue-2");
    assert_eq!(chunks[1].context_before[0].id, "cue-0");
    assert_eq!(chunks[1].context_after[0].id, "cue-4");
}

#[test]
fn subtitle_prompt_version_invalidates_older_cache_entries() {
    assert_eq!(SUBTITLE_TRANSLATION_PROMPT_VERSION, 1);
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
    let prompt = build_subtitle_translation_prompt(&chunks[1], "Japanese");

    assert!(prompt.contains("Return valid JSON only."));
    assert!(prompt.contains("cuesToTranslate"));
    assert!(prompt.contains("expectedCueIds"));
    assert!(prompt.contains("contextBefore"));
    assert!(prompt.contains("contextAfter"));
    assert!(prompt.contains("cue-59"));
    assert!(prompt.contains("cue-60"));
    assert!(prompt.contains("cue-119"));
    assert!(prompt.contains("cue-120"));
    assert!(prompt.contains("contextBefore and contextAfter are reference context only"));
    assert!(prompt.contains("Do not output ids from contextBefore or contextAfter."));
    assert!(prompt.contains("Translate the subtitle timeline"));
    assert!(prompt.contains("natural, respectful subtitle style appropriate for Japanese"));
    assert!(prompt.contains("Timing alignment is more important than making each cue standalone."));
    assert!(prompt.contains("plan the surrounding sentence meaning first"));
    assert!(prompt.contains("Split that translated sentence into subtitle fragments"));
    assert!(prompt.contains("Keep fragment length balanced for the cue duration"));
    assert!(prompt.contains("Do not force every fragment to be a complete sentence."));
    assert!(prompt.contains("Avoid overly casual slang"));
    assert!(prompt.contains("Do not introduce first-person pronouns"));
    assert!(prompt.contains("Keep protected technical names exactly as written"));
    assert!(prompt.contains("distribute the translated sentence across those cue ids by timing"));
    assert!(prompt.contains("Natural subtitle examples"));
    assert!(prompt.contains("Target fragments"));
    assert!(prompt.contains("Avoid repeating the same target fragment across adjacent cues"));
    assert!(prompt.contains("Do not merge, split, drop, or reorder cues."));
    assert!(!prompt.contains("Korean"));
    assert!(!prompt.contains("반말"));
    assert!(!prompt.contains("제가 이 방식을 선택한 건"));
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
fn validation_rejects_missing_duplicate_or_empty_target_cues() {
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
        r#"{"cues":[{"id":"a","translatedText":"안녕"},{"id":"a","translatedText":"안녕 again"}]}"#
    )
    .is_err());
    assert!(validate_subtitle_translation_output(
        &source,
        r#"{"cues":[{"id":"a","translatedText":"안녕"},{"id":"b","translatedText":"   "}]}"#
    )
    .is_err());
}

#[test]
fn validation_reorders_target_cues_by_source_order() {
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

    let translated = validate_subtitle_translation_output(
        &source,
        r#"{"cues":[{"id":"b","translatedText":"잘 가"},{"id":"a","translatedText":"안녕"}]}"#,
    )
    .unwrap();

    assert_eq!(translated[0].id, "a");
    assert_eq!(translated[0].translated_text, "안녕");
    assert_eq!(translated[1].id, "b");
    assert_eq!(translated[1].translated_text, "잘 가");
}

#[test]
fn validation_rejects_implausibly_long_target_for_short_source_cue() {
    let source = vec![SubtitleCue {
        id: "next-step".to_string(),
        start_ms: 10_000,
        end_ms: 12_000,
        text: "check the next section".to_string(),
    }];

    assert!(validate_subtitle_translation_output(
        &source,
        r#"{"cues":[{"id":"next-step","translatedText":"다음 부분을 확인해 주세요. 그리고 그 전에 방금 설명한 모든 설정과 주의사항, 실행 방법, 예상되는 결과까지 한꺼번에 자세히 기억해 두시면 이어지는 작업을 훨씬 수월하게 따라갈 수 있습니다."}]}"#,
    )
    .is_err());
}

#[test]
fn validation_rejects_overloaded_target_for_short_timed_cue() {
    let source = vec![SubtitleCue {
        id: "tax".to_string(),
        start_ms: 129_000,
        end_ms: 131_000,
        text: "two code bases is a tax that you have to".to_string(),
    }];

    assert!(validate_subtitle_translation_output(
        &source,
        r#"{"cues":[{"id":"tax","translatedText":"많은 회사가 네이티브에서 React Native로 전환하는 이유는, 두 개의 코드베이스가 평생 지불해야 하는 세금이기 때문입니다."}]}"#,
    )
    .is_err());
}

#[test]
fn quality_audit_flags_protected_term_drift() {
    let source = vec![
        SubtitleCue {
            id: "cue-intro".to_string(),
            start_ms: 0,
            end_ms: 1_000,
            text: "start from the project".to_string(),
        },
        SubtitleCue {
            id: "cue-tool".to_string(),
            start_ms: 1_000,
            end_ms: 3_000,
            text: "open Xcode before running it".to_string(),
        },
    ];
    let translated = vec![
        translated("cue-intro", "Expo에서 프로젝트를 시작하세요"),
        translated("cue-tool", "실행하기 전에 도구를 여세요"),
    ];

    let issues = audit_subtitle_translation_quality(&source, &translated);
    let issue_pairs = issues
        .iter()
        .map(|issue| (issue.id.as_str(), issue.reason.as_str()))
        .collect::<Vec<_>>();

    assert!(issue_pairs.contains(&("cue-intro", "borrowedProtectedTerm")));
    assert!(issue_pairs.contains(&("cue-tool", "missingProtectedTerm")));
}

#[test]
fn quality_audit_does_not_treat_ai_inside_regular_words_as_a_protected_term() {
    let source = vec![SubtitleCue {
        id: "cue-said".to_string(),
        start_ms: 0,
        end_ms: 2_000,
        text: "they said the preview is ready".to_string(),
    }];
    let translated = vec![translated("cue-said", "미리보기가 준비됐다고 말했습니다")];

    let issues = audit_subtitle_translation_quality(&source, &translated);

    assert!(
        issues
            .iter()
            .all(|issue| issue.message.contains("'AI'") == false),
        "AI should not be detected inside ordinary words such as said"
    );
}

#[test]
fn quality_audit_flags_general_tone_length_and_duplicate_timeline_risks() {
    let source = vec![
        SubtitleCue {
            id: "cue-long".to_string(),
            start_ms: 0,
            end_ms: 1_000,
            text: "short note".to_string(),
        },
        SubtitleCue {
            id: "cue-tone".to_string(),
            start_ms: 1_000,
            end_ms: 2_000,
            text: "start here".to_string(),
        },
        SubtitleCue {
            id: "cue-first-person".to_string(),
            start_ms: 2_000,
            end_ms: 3_000,
            text: "the setting opens".to_string(),
        },
        SubtitleCue {
            id: "cue-dup-a".to_string(),
            start_ms: 3_000,
            end_ms: 4_000,
            text: "first point".to_string(),
        },
        SubtitleCue {
            id: "cue-dup-b".to_string(),
            start_ms: 4_000,
            end_ms: 5_000,
            text: "second point".to_string(),
        },
        SubtitleCue {
            id: "cue-owned".to_string(),
            start_ms: 5_000,
            end_ms: 6_000,
            text: "i want my app to feel simple".to_string(),
        },
    ];
    let translated = vec![
        translated(
            "cue-long",
            "짧은 메모입니다. 그런데 이 자막에는 다음 장면의 설명과 실행 순서, 확인해야 할 설정까지 모두 길게 들어가 있어서 한 줄 자막으로 보기 어렵습니다.",
        ),
        translated("cue-tone", "여기서 시작해"),
        translated("cue-first-person", "제가 설정을 엽니다"),
        translated("cue-dup-a", "같은 번역 문장입니다"),
        translated("cue-dup-b", "같은 번역 문장입니다"),
        translated("cue-owned", "내 앱이 단순하게 느껴지길 바랍니다"),
    ];

    let issues = audit_subtitle_translation_quality(&source, &translated);
    let issue_pairs = issues
        .iter()
        .map(|issue| (issue.id.as_str(), issue.reason.as_str()))
        .collect::<Vec<_>>();

    assert!(issue_pairs.contains(&("cue-long", "implausiblyLongTargetCue")));
    assert!(issue_pairs.contains(&("cue-dup-a", "duplicatedAdjacentTranslation")));
    assert!(issue_pairs.contains(&("cue-dup-b", "duplicatedAdjacentTranslation")));
    assert!(!issue_pairs.contains(&("cue-tone", "casualKoreanStyle")));
    assert!(!issue_pairs.contains(&("cue-owned", "informalFirstPerson")));
    assert!(!issue_pairs.contains(&("cue-first-person", "borrowedFirstPerson")));
}

#[test]
fn quality_audit_allows_natural_distribution_across_neighboring_cues() {
    let source = vec![
        SubtitleCue {
            id: "cue-sentence".to_string(),
            start_ms: 0,
            end_ms: 1_000,
            text: "when a sentence continues".to_string(),
        },
        SubtitleCue {
            id: "cue-across".to_string(),
            start_ms: 1_000,
            end_ms: 2_000,
            text: "across multiple captions".to_string(),
        },
        SubtitleCue {
            id: "cue-natural".to_string(),
            start_ms: 2_000,
            end_ms: 3_000,
            text: "keep it natural".to_string(),
        },
    ];
    let translated = vec![
        translated("cue-sentence", "문장이 여러 자막에 이어질 때는"),
        translated("cue-across", "각 조각이 완결문이 아니어도"),
        translated("cue-natural", "함께 자연스럽게 읽히면 됩니다"),
    ];

    let issues = audit_subtitle_translation_quality(&source, &translated);

    assert!(
        issues.is_empty(),
        "natural distribution across neighboring cue fragments should not be scored as cue drift: {issues:?}"
    );
}

#[test]
fn quality_audit_does_not_flag_target_language_specific_tone() {
    let source = vec![
        SubtitleCue {
            id: "cue-question".to_string(),
            start_ms: 0,
            end_ms: 1_000,
            text: "why choose this approach".to_string(),
        },
        SubtitleCue {
            id: "cue-apps".to_string(),
            start_ms: 1_000,
            end_ms: 2_000,
            text: "i want my app to feel simple".to_string(),
        },
        SubtitleCue {
            id: "cue-thing".to_string(),
            start_ms: 2_000,
            end_ms: 3_000,
            text: "here is the main point".to_string(),
        },
        SubtitleCue {
            id: "cue-start".to_string(),
            start_ms: 3_000,
            end_ms: 4_000,
            text: "start with this tool".to_string(),
        },
    ];
    let translated = vec![
        translated("cue-question", "왜 이 방식을 선택할까"),
        translated("cue-apps", "내 앱이 단순하게 느껴지길 바랍니다"),
        translated("cue-thing", "핵심은 이거야"),
        translated("cue-start", "이 도구로 시작해"),
    ];

    let issues = audit_subtitle_translation_quality(&source, &translated);
    let issue_pairs = issues
        .iter()
        .map(|issue| (issue.id.as_str(), issue.reason.as_str()))
        .collect::<Vec<_>>();

    assert!(!issue_pairs.contains(&("cue-question", "casualKoreanStyle")));
    assert!(!issue_pairs.contains(&("cue-apps", "informalFirstPerson")));
    assert!(!issue_pairs.contains(&("cue-thing", "casualKoreanStyle")));
    assert!(!issue_pairs.contains(&("cue-start", "casualKoreanStyle")));
}

#[test]
fn quality_audit_leaves_language_register_to_the_prompt() {
    let source = vec![SubtitleCue {
        id: "cue-module".to_string(),
        start_ms: 147_000,
        end_ms: 150_000,
        text: "write a custom Expo module and tap into it".to_string(),
    }];
    let translated = vec![translated("cue-module", "커스텀 Expo 모듈을 통해")];

    let issues = audit_subtitle_translation_quality(&source, &translated);

    assert!(issues
        .iter()
        .all(|issue| issue.reason != "casualKoreanStyle"));
}

#[test]
fn quality_audit_does_not_repair_language_specific_first_person_choices() {
    let source = vec![
        SubtitleCue {
            id: "cue-reason".to_string(),
            start_ms: 123_000,
            end_ms: 126_000,
            text: "and it's exactly why so many of them move".to_string(),
        },
        SubtitleCue {
            id: "cue-native".to_string(),
            start_ms: 126_000,
            end_ms: 129_000,
            text: "from native to React Native".to_string(),
        },
    ];
    let translated = vec![
        translated("cue-reason", "제가"),
        translated("cue-native", "네이티브에서 React Native로"),
    ];

    let issues = audit_subtitle_translation_quality(&source, &translated);
    let issue_pairs = issues
        .iter()
        .map(|issue| (issue.id.as_str(), issue.reason.as_str()))
        .collect::<Vec<_>>();

    assert!(!issue_pairs.contains(&("cue-reason", "borrowedFirstPerson")));
}

#[test]
fn repair_prompt_includes_quality_issues_and_current_translations() {
    let cues = vec![
        SubtitleCue {
            id: "cue-tool".to_string(),
            start_ms: 0,
            end_ms: 2_000,
            text: "open Xcode".to_string(),
        },
        SubtitleCue {
            id: "cue-start".to_string(),
            start_ms: 2_000,
            end_ms: 4_000,
            text: "and start from the preview".to_string(),
        },
    ];
    let chunk = plan_subtitle_chunks(&cues).remove(0);
    let translated = vec![
        translated("cue-tool", "도구를 열고"),
        translated("cue-start", "미리보기에서 시작해"),
    ];
    let issues = audit_subtitle_translation_quality(&chunk.cues, &translated);

    let prompt = build_subtitle_repair_prompt(&chunk, &translated, &issues, "Korean");

    assert!(prompt.contains("qualityIssues"));
    assert!(prompt.contains("currentTranslations"));
    assert!(prompt.contains("cue-tool"));
    assert!(prompt.contains("Xcode"));
    assert!(prompt.contains("distribute the translated sentence across those cue ids by timing"));
    assert!(prompt.contains("Repair neighboring target cues"));
    assert!(prompt.contains("joined Korean subtitle text reads naturally"));
    assert!(prompt.contains("Natural subtitle examples"));
    assert!(prompt.contains("expectedCueIds"));
}

#[test]
fn validation_ignores_extra_context_cues_when_target_cues_are_complete() {
    let source = vec![
        SubtitleCue {
            id: "target-a".to_string(),
            start_ms: 1_000,
            end_ms: 2_000,
            text: "This is the cue to translate.".to_string(),
        },
        SubtitleCue {
            id: "target-b".to_string(),
            start_ms: 2_000,
            end_ms: 3_000,
            text: "Keep the target ids only.".to_string(),
        },
    ];

    let translated = validate_subtitle_translation_output(
        &source,
        r#"{"cues":[{"id":"context-before","translatedText":"앞 문맥"},{"id":"target-a","translatedText":"번역 대상 자막입니다."},{"id":"target-b","translatedText":"대상 ID만 유지하세요."},{"id":"context-after","translatedText":"뒤 문맥"}]}"#,
    )
    .unwrap();

    assert_eq!(translated.len(), 2);
    assert_eq!(translated[0].id, "target-a");
    assert_eq!(translated[0].translated_text, "번역 대상 자막입니다.");
    assert_eq!(translated[1].id, "target-b");
}

fn translated(id: &str, translated_text: &str) -> TranslatedSubtitleCue {
    TranslatedSubtitleCue {
        id: id.to_string(),
        start_ms: 0,
        end_ms: 1_000,
        translated_text: translated_text.to_string(),
    }
}
