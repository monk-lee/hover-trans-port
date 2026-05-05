import { createHash } from "node:crypto";

export function normalizeForCache(text) {
  return String(text ?? "").replace(/\s+/gu, " ").trim();
}

export function hashNormalizedText(normalizedText) {
  return createHash("sha256").update(normalizedText, "utf8").digest("hex");
}

function normalizeDimension(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

export function createTranslationCacheKey({
  provider = "codex",
  model = "default",
  targetLang,
  text
}) {
  const normalizedText = normalizeForCache(text);

  return {
    provider: normalizeDimension(provider, "codex"),
    model: normalizeDimension(model, "default"),
    targetLang: normalizeDimension(targetLang, "ko"),
    textHash: hashNormalizedText(normalizedText),
    normalizedText
  };
}
