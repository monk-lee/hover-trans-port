use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};

use crate::cache_key::TranslationCacheKey;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CacheHit {
    pub translated_text: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ClearResult {
    pub deleted_rows: usize,
}

pub struct SqliteTranslationCache<F>
where
    F: Fn() -> i64,
{
    database_path: PathBuf,
    now: F,
}

impl<F> SqliteTranslationCache<F>
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

    pub fn lookup(&self, key: &TranslationCacheKey) -> rusqlite::Result<Option<CacheHit>> {
        let connection = self.open()?;
        let mut statement = connection.prepare(
            "
            SELECT translated_text
            FROM translation_cache
            WHERE provider = ?1
              AND model = ?2
              AND target_lang = ?3
              AND text_hash = ?4
            ",
        )?;

        let mut rows = statement.query(params![
            key.provider.as_str(),
            key.model,
            key.target_lang,
            key.text_hash
        ])?;

        let Some(row) = rows.next()? else {
            return Ok(None);
        };

        let translated_text: String = row.get(0)?;
        drop(rows);
        drop(statement);

        connection.execute(
            "
            UPDATE translation_cache
            SET last_used_at = ?5,
                hit_count = hit_count + 1
            WHERE provider = ?1
              AND model = ?2
              AND target_lang = ?3
              AND text_hash = ?4
            ",
            params![
                key.provider.as_str(),
                key.model,
                key.target_lang,
                key.text_hash,
                (self.now)()
            ],
        )?;

        Ok(Some(CacheHit { translated_text }))
    }

    pub fn write(&self, key: &TranslationCacheKey, translated_text: &str) -> rusqlite::Result<()> {
        let connection = self.open()?;
        let timestamp = (self.now)();

        connection.execute(
            "
            INSERT INTO translation_cache (
              provider,
              model,
              target_lang,
              text_hash,
              source_text,
              translated_text,
              created_at,
              last_used_at,
              hit_count
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 0)
            ON CONFLICT(provider, model, target_lang, text_hash)
            DO UPDATE SET
              source_text = excluded.source_text,
              translated_text = excluded.translated_text,
              last_used_at = excluded.last_used_at
            ",
            params![
                key.provider.as_str(),
                key.model,
                key.target_lang,
                key.text_hash,
                key.normalized_text,
                translated_text,
                timestamp
            ],
        )?;

        Ok(())
    }

    pub fn clear(&self) -> rusqlite::Result<ClearResult> {
        let connection = self.open()?;
        let deleted_rows = connection.execute("DELETE FROM translation_cache", [])?;

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

pub fn resolve_translation_cache_path() -> PathBuf {
    resolve_translation_cache_path_from_env(&std::env::vars().collect())
}

pub fn resolve_translation_cache_path_from_env(env: &BTreeMap<String, String>) -> PathBuf {
    if let Some(path) = env.get("HOVER_TRANS_PORT_CACHE_PATH") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    if let Some(dir) = env.get("HOVER_TRANS_PORT_CACHE_DIR") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return Path::new(trimmed).join("cache.sqlite");
        }
    }

    if let Some(home) = env.get("HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return Path::new(trimmed)
                .join(".hover-trans-port")
                .join("cache.sqlite");
        }
    }

    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".hover-trans-port")
        .join("cache.sqlite")
}

fn initialize(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS translation_cache (
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          target_lang TEXT NOT NULL,
          text_hash TEXT NOT NULL,
          source_text TEXT NOT NULL,
          translated_text TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_used_at INTEGER NOT NULL,
          hit_count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (provider, model, target_lang, text_hash)
        );

        CREATE INDEX IF NOT EXISTS idx_translation_cache_last_used_at
        ON translation_cache(last_used_at);
        ",
    )
}
