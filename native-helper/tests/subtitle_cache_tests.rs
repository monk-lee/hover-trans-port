use hover_trans_port_helper::messages::ProviderId;
use hover_trans_port_helper::subtitle_cache::{SqliteSubtitleTranslationCache, SubtitleCacheKey};
use hover_trans_port_helper::subtitles::{SubtitleCue, TranslatedSubtitleCue};
use rusqlite::Connection;
use tempfile::tempdir;

fn cache_key() -> SubtitleCacheKey {
    SubtitleCacheKey {
        provider: ProviderId::Codex,
        model: "gpt-5.4-mini".to_string(),
        target_lang: "Korean".to_string(),
        video_id: "video-1".to_string(),
        source_track_identity: "track-1".to_string(),
        source_timeline_hash: "timeline-1".to_string(),
        prompt_version: 1,
    }
}

fn source_cues() -> Vec<SubtitleCue> {
    vec![SubtitleCue {
        id: "cue-1".to_string(),
        start_ms: 0,
        end_ms: 1000,
        text: "Hello".to_string(),
    }]
}

fn translated_cues() -> Vec<TranslatedSubtitleCue> {
    vec![TranslatedSubtitleCue {
        id: "cue-1".to_string(),
        start_ms: 0,
        end_ms: 1000,
        translated_text: "안녕".to_string(),
    }]
}

#[test]
fn subtitle_cache_miss_returns_none() {
    let temp = tempdir().unwrap();
    let path = temp.path().join("cache.sqlite");
    let cache = SqliteSubtitleTranslationCache::new(path, || 1_000);

    assert!(cache.lookup(&cache_key()).unwrap().is_none());
}

#[test]
fn subtitle_cache_write_then_lookup_returns_cues_and_updates_usage() {
    let temp = tempdir().unwrap();
    let path = temp.path().join("cache.sqlite");
    let cache = SqliteSubtitleTranslationCache::new(path.clone(), || 1_000);

    cache
        .write(&cache_key(), &source_cues(), &translated_cues())
        .expect("subtitle cache write should succeed");

    let cache = SqliteSubtitleTranslationCache::new(path.clone(), || 2_000);
    let hit = cache
        .lookup(&cache_key())
        .expect("subtitle cache lookup should succeed")
        .expect("subtitle cache hit should exist");

    assert_eq!(hit.cues[0].translated_text, "안녕");

    let db = Connection::open(path).unwrap();
    let (hit_count, last_used_at): (i64, i64) = db
        .query_row(
            "SELECT hit_count, last_used_at FROM subtitle_translation_cache",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();

    assert_eq!(hit_count, 1);
    assert_eq!(last_used_at, 2_000);
}

#[test]
fn subtitle_cache_clear_returns_deleted_row_count() {
    let temp = tempdir().unwrap();
    let path = temp.path().join("cache.sqlite");
    let cache = SqliteSubtitleTranslationCache::new(path, || 1_000);
    let first = cache_key();
    let second = SubtitleCacheKey {
        video_id: "video-2".to_string(),
        source_timeline_hash: "timeline-2".to_string(),
        ..cache_key()
    };

    cache
        .write(&first, &source_cues(), &translated_cues())
        .unwrap();
    cache
        .write(&second, &source_cues(), &translated_cues())
        .unwrap();

    assert_eq!(cache.clear().unwrap().deleted_rows, 2);
}
