export const PROVIDER_IDS = ["codex", "claude", "gemini", "opencode"] as const;
export const AUTO_PROVIDER = "auto" as const;
export const PROVIDER_SELECTION_IDS = [...PROVIDER_IDS, AUTO_PROVIDER] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];
export type ProviderSelection = (typeof PROVIDER_SELECTION_IDS)[number];
export type ProviderModelOption = {
  value: string;
  label: string;
  recommended?: boolean;
};

export type ProviderModelCatalog = {
  provider: ProviderId;
  defaultModel: string;
  models: ProviderModelOption[];
  supportsCustomModel: boolean;
  source: "cli" | "fallback";
};

export const DEFAULT_PROVIDER: ProviderId = "codex";

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  codex: "Codex CLI",
  claude: "Claude CLI",
  gemini: "Gemini CLI",
  opencode: "OpenCode CLI"
};

export const PROVIDER_DEFAULT_MODELS: Record<ProviderId, string> = {
  codex: "gpt-5.4-mini",
  claude: "haiku",
  gemini: "",
  opencode: ""
};

export const PROVIDER_FALLBACK_MODEL_CATALOGS: Record<
  ProviderId,
  ProviderModelCatalog
> = {
  codex: {
    provider: "codex",
    defaultModel: "gpt-5.4-mini",
    models: [
      { value: "gpt-5.5", label: "GPT-5.5" },
      { value: "gpt-5.4", label: "GPT-5.4" },
      { value: "gpt-5.4-mini", label: "GPT-5.4 Mini", recommended: true },
      { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
      { value: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
      { value: "gpt-5.2", label: "GPT-5.2" }
    ],
    supportsCustomModel: true,
    source: "fallback"
  },
  claude: {
    provider: "claude",
    defaultModel: "haiku",
    models: [
      { value: "haiku", label: "Haiku", recommended: true },
      { value: "sonnet", label: "Sonnet" },
      { value: "opus", label: "Opus" },
      { value: "default", label: "Default (Claude CLI)" }
    ],
    supportsCustomModel: true,
    source: "fallback"
  },
  gemini: {
    provider: "gemini",
    defaultModel: "",
    models: [
      { value: "", label: "Default (Gemini CLI)", recommended: true },
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }
    ],
    supportsCustomModel: true,
    source: "fallback"
  },
  opencode: {
    provider: "opencode",
    defaultModel: "",
    models: [
      { value: "", label: "Default (OpenCode CLI)", recommended: true }
    ],
    supportsCustomModel: true,
    source: "fallback"
  }
};

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && PROVIDER_IDS.includes(value as ProviderId);
}

export function isProviderSelection(
  value: unknown
): value is ProviderSelection {
  return (
    typeof value === "string" &&
    PROVIDER_SELECTION_IDS.includes(value as ProviderSelection)
  );
}

export function normalizeProvider(
  provider: string | undefined
): ProviderSelection {
  return isProviderSelection(provider) ? provider : DEFAULT_PROVIDER;
}

export function resolveProviderForModel(provider: ProviderSelection): ProviderId {
  return provider === AUTO_PROVIDER ? DEFAULT_PROVIDER : provider;
}

export function getProviderLabel(
  provider: ProviderId | ProviderSelection
): string {
  const providerId = resolveProviderForModel(normalizeProvider(provider));
  return PROVIDER_LABELS[providerId];
}

export function getDefaultModelForProvider(provider: ProviderId): string {
  return PROVIDER_DEFAULT_MODELS[provider];
}

export function getFallbackModelCatalog(
  provider: ProviderId
): ProviderModelCatalog {
  return PROVIDER_FALLBACK_MODEL_CATALOGS[provider];
}

export function getModelOptionsForProvider(
  provider: ProviderId
): ProviderModelOption[] {
  return getFallbackModelCatalog(provider).models;
}
