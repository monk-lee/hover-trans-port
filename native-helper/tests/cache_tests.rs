use hover_trans_port_helper::cache::SqliteTranslationCache;
use hover_trans_port_helper::cache_key::create_translation_cache_key;
use hover_trans_port_helper::messages::ProviderId;
use hover_trans_port_helper::prompt::build_translate_prompt;
use rusqlite::Connection;
use tempfile::tempdir;

#[test]
fn prompt_matches_native_host_constraints() {
    let prompt = build_translate_prompt("Hello", "auto", "Korean");

    assert!(prompt.contains("Translate the following text to Korean."));
    assert!(prompt.contains("Return only the translated text."));
    assert!(prompt.contains("Do not output raw HTML."));
    assert!(prompt.contains("Source language: auto"));
    assert!(prompt.ends_with("Text:\nHello"));
}

#[test]
fn cache_miss_returns_none() {
    let temp = tempdir().unwrap();
    let path = temp.path().join("cache.sqlite");
    let cache = SqliteTranslationCache::new(path, || 1_000);
    let key = create_translation_cache_key(ProviderId::Codex, "gpt-5.4-mini", "Korean", "Hello");

    assert!(cache.lookup(&key).unwrap().is_none());
}

#[test]
fn write_then_lookup_returns_translated_text_and_updates_usage() {
    let temp = tempdir().unwrap();
    let path = temp.path().join("cache.sqlite");
    let cache = SqliteTranslationCache::new(path.clone(), || 1_000);
    let key = create_translation_cache_key(
        ProviderId::Codex,
        "gpt-5.4-mini",
        "Korean",
        "  Hello   world  ",
    );

    cache
        .write(&key, "안녕 세계")
        .expect("cache write should succeed");

    let cache = SqliteTranslationCache::new(path.clone(), || 2_000);
    let hit = cache
        .lookup(&key)
        .expect("cache lookup should succeed")
        .expect("cache hit should exist");

    assert_eq!(hit.translated_text, "안녕 세계");

    let db = Connection::open(path).unwrap();
    let (source_text, hit_count, last_used_at): (String, i64, i64) = db
        .query_row(
            "SELECT source_text, hit_count, last_used_at FROM translation_cache",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();

    assert_eq!(source_text, "Hello world");
    assert_eq!(hit_count, 1);
    assert_eq!(last_used_at, 2_000);
}

#[test]
fn clear_returns_deleted_row_count() {
    let temp = tempdir().unwrap();
    let path = temp.path().join("cache.sqlite");
    let cache = SqliteTranslationCache::new(path, || 1_000);
    let first = create_translation_cache_key(ProviderId::Codex, "gpt-5.4-mini", "Korean", "Hello");
    let second = create_translation_cache_key(ProviderId::Codex, "gpt-5.4-mini", "Korean", "Bye");

    cache.write(&first, "안녕").unwrap();
    cache.write(&second, "잘 가").unwrap();

    assert_eq!(cache.clear().unwrap().deleted_rows, 2);
}
