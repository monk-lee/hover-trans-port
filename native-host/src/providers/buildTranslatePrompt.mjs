const DEFAULT_TARGET_LANG = "Korean";

function normalizePromptLanguage(language) {
  const normalized = String(language ?? "").trim();
  return normalized || DEFAULT_TARGET_LANG;
}

export function buildTranslatePrompt({
  text,
  sourceLang = "auto",
  targetLang = DEFAULT_TARGET_LANG
}) {
  const normalizedTargetLang = normalizePromptLanguage(targetLang);

  return [
    `Translate the following text to ${normalizedTargetLang}.`,
    "Return only the translated text.",
    "Do not explain.",
    "Do not include markdown fences.",
    "Preserve meaning, tone, inline code, links, numbers, and product names.",
    "If the text contains [HTP_INLINE_n] and [/HTP_INLINE_n] markers, keep each marker pair exactly once around the translated phrase corresponding to that marked source phrase.",
    "Do not translate HTP_INLINE marker tokens.",
    "Do not output raw HTML.",
    "Do not browse or access files.",
    `Source language: ${sourceLang}`,
    `Target language: ${normalizedTargetLang}`,
    "",
    "Text:",
    text
  ].join("\n");
}
