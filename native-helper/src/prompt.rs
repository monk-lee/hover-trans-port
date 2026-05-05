const DEFAULT_TARGET_LANG: &str = "Korean";

fn normalize_prompt_language(language: &str) -> String {
    let normalized = language.trim();
    if normalized.is_empty() {
        DEFAULT_TARGET_LANG.to_string()
    } else {
        normalized.to_string()
    }
}

pub fn build_translate_prompt(text: &str, source_lang: &str, target_lang: &str) -> String {
    let target_lang = normalize_prompt_language(target_lang);

    [
        format!("Translate the following text to {target_lang}."),
        "Return only the translated text.".to_string(),
        "Do not explain.".to_string(),
        "Do not include markdown fences.".to_string(),
        "Preserve meaning, tone, inline code, links, numbers, and product names.".to_string(),
        "If the text contains [HTP_INLINE_n] and [/HTP_INLINE_n] markers, keep each marker pair exactly once around the translated phrase corresponding to that marked source phrase.".to_string(),
        "Do not translate HTP_INLINE marker tokens.".to_string(),
        "Do not output raw HTML.".to_string(),
        "Do not browse or access files.".to_string(),
        format!("Source language: {source_lang}"),
        format!("Target language: {target_lang}"),
        String::new(),
        "Text:".to_string(),
        text.to_string(),
    ]
    .join("\n")
}
