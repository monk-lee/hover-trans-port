use std::fs;
use std::path::PathBuf;

use rusqlite::types::Type;
use rusqlite::{params, Connection};

use crate::cache::resolve_translation_cache_path;
use crate::messages::ProviderId;
use crate::subtitles::{SubtitleCue, TranslatedSubtitleCue};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubtitleCacheKey {
    pub provider: ProviderId,
    pub model: String,
    pub target_lang: String,
    pub video_id: String,
    pub source_track_identity: String,
    pub source_timeline_hash: String,
    pub prompt_version: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubtitleCacheHit {
    pub cues: Vec<TranslatedSubtitleCue>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ClearResult {
    pub deleted_rows: usize,
}

pub struct SqliteSubtitleTranslationCache<F>
where
    F: Fn() -> i64,
{
    database_path: PathBuf,
    now: F,
}

impl<F> SqliteSubtitleTranslationCache<F>
where
    F: Fn() -> i64,
{
    pub fn new<P>(database_path: P, now: F) -> Self
    where
        P: Into<PathBuf>,
    {
        Self {
            database_path: database_path.into(),
            now,
        }
    }

    pub fn lookup(&self, key: &SubtitleCacheKey) -> rusqlite::Result<Option<SubtitleCacheHit>> {
        let connection = self.open()?;
        let mut statement = connection.prepare(
            "
            SELECT translated_cues_json
            FROM subtitle_translation_cache
            WHERE provider = ?1
              AND model = ?2
              AND target_lang = ?3
              AND video_id = ?4
              AND source_track_identity = ?5
              AND source_timeline_hash = ?6
              AND prompt_version = ?7
            ",
        )?;

        let mut rows = statement.query(params![
            key.provider.as_str(),
            normalized_model(&key.model),
            key.target_lang.as_str(),
            key.video_id.as_str(),
            key.source_track_identity.as_str(),
            key.source_timeline_hash.as_str(),
            key.prompt_version as i64
        ])?;

        let Some(row) = rows.next()? else {
            return Ok(None);
        };

        let translated_cues_json: String = row.get(0)?;
        let cues = serde_json::from_str::<Vec<TranslatedSubtitleCue>>(&translated_cues_json)
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(0, Type::Text, Box::new(error))
            })?;
        drop(rows);
        drop(statement);

        connection.execute(
            "
            UPDATE subtitle_translation_cache
            SET last_used_at = ?8,
                hit_count = hit_count + 1
            WHERE provider = ?1
              AND model = ?2
              AND target_lang = ?3
              AND video_id = ?4
              AND source_track_identity = ?5
              AND source_timeline_hash = ?6
              AND prompt_version = ?7
            ",
            params![
                key.provider.as_str(),
                normalized_model(&key.model),
                key.target_lang.as_str(),
                key.video_id.as_str(),
                key.source_track_identity.as_str(),
                key.source_timeline_hash.as_str(),
                key.prompt_version as i64,
                (self.now)()
            ],
        )?;

        Ok(Some(SubtitleCacheHit { cues }))
    }

    pub fn write(
        &self,
        key: &SubtitleCacheKey,
        source_cues: &[SubtitleCue],
        translated_cues: &[TranslatedSubtitleCue],
    ) -> rusqlite::Result<()> {
        let connection = self.open()?;
        let timestamp = (self.now)();
        let source_cues_json = serde_json::to_string(source_cues)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let translated_cues_json = serde_json::to_string(translated_cues)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;

        connection.execute(
            "
            INSERT INTO subtitle_translation_cache (
              provider,
              model,
              target_lang,
              video_id,
              source_track_identity,
              source_timeline_hash,
              prompt_version,
              source_cues_json,
              translated_cues_json,
              created_at,
              last_used_at,
              hit_count
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, 0)
            ON CONFLICT(
              provider,
              model,
              target_lang,
              video_id,
              source_track_identity,
              source_timeline_hash,
              prompt_version
            )
            DO UPDATE SET
              source_cues_json = excluded.source_cues_json,
              translated_cues_json = excluded.translated_cues_json,
              last_used_at = excluded.last_used_at
            ",
            params![
                key.provider.as_str(),
                normalized_model(&key.model),
                key.target_lang.as_str(),
                key.video_id.as_str(),
                key.source_track_identity.as_str(),
                key.source_timeline_hash.as_str(),
                key.prompt_version as i64,
                source_cues_json,
                translated_cues_json,
                timestamp
            ],
        )?;

        Ok(())
    }

    pub fn clear(&self) -> rusqlite::Result<ClearResult> {
        let connection = self.open()?;
        let deleted_rows = connection.execute("DELETE FROM subtitle_translation_cache", [])?;

        Ok(ClearResult { deleted_rows })
    }

    fn open(&self) -> rusqlite::Result<Connection> {
        if let Some(parent) = self.database_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        }

        let connection = Connection::open(&self.database_path)?;
        initialize(&connection)?;
        Ok(connection)
    }
}

pub fn resolve_subtitle_cache_path() -> PathBuf {
    resolve_translation_cache_path()
}

fn normalized_model(model: &str) -> &str {
    let trimmed = model.trim();

    if trimmed.is_empty() {
        "default"
    } else {
        trimmed
    }
}

fn initialize(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS subtitle_translation_cache (
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          target_lang TEXT NOT NULL,
          video_id TEXT NOT NULL,
          source_track_identity TEXT NOT NULL,
          source_timeline_hash TEXT NOT NULL,
          prompt_version INTEGER NOT NULL,
          source_cues_json TEXT NOT NULL,
          translated_cues_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_used_at INTEGER NOT NULL,
          hit_count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (
            provider,
            model,
            target_lang,
            video_id,
            source_track_identity,
            source_timeline_hash,
            prompt_version
          )
        );

        CREATE INDEX IF NOT EXISTS idx_subtitle_translation_cache_last_used_at
        ON subtitle_translation_cache(last_used_at);
        ",
    )
}
