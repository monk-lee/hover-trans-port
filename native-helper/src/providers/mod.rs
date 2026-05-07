pub mod claude;
pub mod codex;
pub mod gemini;

use std::collections::BTreeMap;

use crate::messages::{ProviderId, ProviderStatusEntry};
use crate::process::ProviderError;

#[derive(Clone, Debug)]
pub struct ProviderTranslateRequest {
    pub text: String,
    pub model: Option<String>,
    pub source_lang: String,
    pub target_lang: String,
    pub timeout_ms: u64,
}

#[derive(Clone, Debug)]
pub struct ProviderTranslateResult {
    pub translated_text: String,
    pub elapsed_ms: u64,
}

pub trait Provider {
    fn id(&self) -> ProviderId;
    fn label(&self) -> &'static str;
    fn default_model(&self) -> &'static str;
    fn status(&self) -> ProviderStatusEntry;
    fn translate(
        &self,
        request: ProviderTranslateRequest,
    ) -> Result<ProviderTranslateResult, ProviderError>;
}

#[derive(Clone, Debug)]
pub struct ProviderRegistry {
    env: BTreeMap<String, String>,
}

impl ProviderRegistry {
    pub fn new(env: BTreeMap<String, String>) -> Self {
        Self { env }
    }

    pub fn status_entries(&self) -> Vec<ProviderStatusEntry> {
        vec![
            codex::CodexProvider::new(self.env.clone()).status(),
            claude::ClaudeProvider::new(self.env.clone()).status(),
            gemini::GeminiProvider::new(self.env.clone()).status(),
        ]
    }

    pub fn translate(
        &self,
        selection: Option<&str>,
        request: ProviderTranslateRequest,
    ) -> Result<(ProviderId, ProviderTranslateResult), ProviderError> {
        match normalize_provider_selection(selection) {
            ProviderSelection::Codex => {
                let provider = codex::CodexProvider::new(self.env.clone());
                provider
                    .translate(request)
                    .map(|result| (provider.id(), result))
            }
            ProviderSelection::Claude => {
                let provider = claude::ClaudeProvider::new(self.env.clone());
                provider
                    .translate(request)
                    .map(|result| (provider.id(), result))
            }
            ProviderSelection::Gemini => {
                let provider = gemini::GeminiProvider::new(self.env.clone());
                provider
                    .translate(request)
                    .map(|result| (provider.id(), result))
            }
        }
    }
}

pub fn resolve_provider_id(selection: Option<&str>) -> ProviderId {
    match normalize_provider_selection(selection) {
        ProviderSelection::Codex => ProviderId::Codex,
        ProviderSelection::Claude => ProviderId::Claude,
        ProviderSelection::Gemini => ProviderId::Gemini,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProviderSelection {
    Codex,
    Claude,
    Gemini,
}

fn normalize_provider_selection(value: Option<&str>) -> ProviderSelection {
    match value {
        Some("claude") => ProviderSelection::Claude,
        Some("gemini") => ProviderSelection::Gemini,
        Some("auto") | Some("codex") | _ => ProviderSelection::Codex,
    }
}
