use sha2::{Digest, Sha256};

use crate::messages::ProviderId;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TranslationCacheKey {
    pub provider: ProviderId,
    pub model: String,
    pub target_lang: String,
    pub text_hash: String,
    pub normalized_text: String,
}

pub fn normalize_for_cache(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn hash_normalized_text(normalized_text: &str) -> String {
    let digest = Sha256::digest(normalized_text.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn normalize_dimension(value: &str, fallback: &str) -> String {
    let normalized = value.trim();
    if normalized.is_empty() {
        fallback.to_string()
    } else {
        normalized.to_string()
    }
}

pub fn create_translation_cache_key(
    provider: ProviderId,
    model: &str,
    target_lang: &str,
    text: &str,
) -> TranslationCacheKey {
    let normalized_text = normalize_for_cache(text);

    TranslationCacheKey {
        provider,
        model: normalize_dimension(model, "default"),
        target_lang: normalize_dimension(target_lang, "ko"),
        text_hash: hash_normalized_text(&normalized_text),
        normalized_text,
    }
}
