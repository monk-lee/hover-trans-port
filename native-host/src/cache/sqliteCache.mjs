import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_CACHE_DIR = join(homedir(), ".hover-trans-port");
const DEFAULT_CACHE_FILENAME = "cache.sqlite";

function toCacheParams(key) {
  return {
    provider: key.provider,
    model: key.model,
    targetLang: key.targetLang,
    textHash: key.textHash
  };
}

export function resolveTranslationCachePath() {
  const explicitPath = process.env.HOVER_TRANS_PORT_CACHE_PATH?.trim();
  if (explicitPath) {
    return explicitPath;
  }

  const cacheDir =
    process.env.HOVER_TRANS_PORT_CACHE_DIR?.trim() || DEFAULT_CACHE_DIR;
  return join(cacheDir, DEFAULT_CACHE_FILENAME);
}

export class SqliteTranslationCache {
  constructor({
    databasePath = resolveTranslationCachePath(),
    now = () => Date.now()
  } = {}) {
    this.databasePath = databasePath;
    this.now = now;
    this.database = undefined;
  }

  open() {
    if (this.database) {
      return this.database;
    }

    mkdirSync(dirname(this.databasePath), { recursive: true });
    this.database = new DatabaseSync(this.databasePath);
    this.database.exec(`
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
    `);

    return this.database;
  }

  lookup(key) {
    const database = this.open();
    const params = toCacheParams(key);
    const row = database
      .prepare(`
        SELECT translated_text AS translatedText
        FROM translation_cache
        WHERE provider = :provider
          AND model = :model
          AND target_lang = :targetLang
          AND text_hash = :textHash
      `)
      .get(params);

    if (!row) {
      return undefined;
    }

    database
      .prepare(`
        UPDATE translation_cache
        SET last_used_at = :lastUsedAt,
            hit_count = hit_count + 1
        WHERE provider = :provider
          AND model = :model
          AND target_lang = :targetLang
          AND text_hash = :textHash
      `)
      .run({ ...params, lastUsedAt: this.now() });

    return {
      translatedText: row.translatedText
    };
  }

  write(key, { translatedText }) {
    const database = this.open();
    const timestamp = this.now();
    const params = toCacheParams(key);

    database
      .prepare(`
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
        VALUES (
          :provider,
          :model,
          :targetLang,
          :textHash,
          :sourceText,
          :translatedText,
          :createdAt,
          :lastUsedAt,
          0
        )
        ON CONFLICT(provider, model, target_lang, text_hash)
        DO UPDATE SET
          source_text = excluded.source_text,
          translated_text = excluded.translated_text,
          last_used_at = excluded.last_used_at
      `)
      .run({
        ...params,
        sourceText: key.normalizedText,
        translatedText,
        createdAt: timestamp,
        lastUsedAt: timestamp
      });
  }

  clear() {
    const database = this.open();
    const result = database.prepare("DELETE FROM translation_cache").run();
    return {
      deletedRows: Number(result.changes ?? 0)
    };
  }

  close() {
    this.database?.close();
    this.database = undefined;
  }
}

export function createTranslationCache(options) {
  return new SqliteTranslationCache(options);
}
