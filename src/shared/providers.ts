export const PROVIDER_IDS = [
  "codex",
  "claude",
  "gemini",
  "opencode",
  "antigravity"
] as const;
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
  opencode: "OpenCode CLI",
  antigravity: "Antigravity CLI"
};

export const PROVIDER_DEFAULT_MODELS: Record<ProviderId, string> = {
  codex: "gpt-6-luna",
  claude: "haiku",
  gemini: "gemini-3.5-flash-lite",
  opencode: "default",
  antigravity: "default"
};

export const CODEX_NOT_FOUND_GUIDANCE =
  "Codex CLI was not found. macOS/Linux: expected paths include ~/.local/bin/codex, ~/.local/share/mise/shims/codex, ~/.nvm/current/bin/codex, ~/.volta/bin/codex, /opt/homebrew/bin/codex, and /usr/local/bin/codex. Windows: install Codex with the official OpenAI installer or run npm install -g @openai/codex, then restart Chrome. Windows expected paths include %LOCALAPPDATA%\\Programs\\OpenAI\\Codex\\bin\\codex.exe and %APPDATA%\\npm\\codex.cmd. You can also set HOVER_TRANS_PORT_CODEX_PATH.";

export const PROVIDER_FALLBACK_MODEL_CATALOGS: Record<
  ProviderId,
  ProviderModelCatalog
> = {
  codex: {
    provider: "codex",
    defaultModel: PROVIDER_DEFAULT_MODELS.codex,
    models: [
      { value: "gpt-6-luna", label: "GPT-6 Luna (medium)", recommended: true },
      { value: "gpt-6.2-sol", label: "GPT-6.2 Sol" },
      { value: "gpt-6.2-astra", label: "GPT-6.2 Astra" },
      { value: "gpt-6.1-terra", label: "GPT-6.1 Terra" }
    ],
    supportsCustomModel: true,
    source: "fallback"
  },
  claude: {
    provider: "claude",
    defaultModel: PROVIDER_DEFAULT_MODELS.claude,
    models: [
      { value: "haiku", label: "Haiku (medium)", recommended: true },
      { value: "sonnet", label: "Sonnet" },
      { value: "opus", label: "Opus" },
      { value: "default", label: "Default (Claude CLI)" }
    ],
    supportsCustomModel: true,
    source: "fallback"
  },
  gemini: {
    provider: "gemini",
    defaultModel: PROVIDER_DEFAULT_MODELS.gemini,
    models: [
      { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (medium)", recommended: true },
      { value: "default", label: "Default (Gemini CLI)" },
      { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
      { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" }
    ],
    supportsCustomModel: true,
    source: "fallback"
  },
  opencode: {
    provider: "opencode",
    defaultModel: PROVIDER_DEFAULT_MODELS.opencode,
    models: [
      { value: "default", label: "Default (OpenCode CLI)", recommended: true }
    ],
    supportsCustomModel: true,
    source: "fallback"
  },
  antigravity: {
    provider: "antigravity",
    defaultModel: PROVIDER_DEFAULT_MODELS.antigravity,
    models: [
      { value: "default", label: "Default (Antigravity CLI)", recommended: true }
    ],
    supportsCustomModel: false,
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

export function formatProviderUnavailableMessage(
  provider: ProviderId | ProviderSelection,
  error: string | undefined
): string {
  const providerId = resolveProviderForModel(normalizeProvider(provider));

  if (providerId === "codex" && error === "PROVIDER_NOT_FOUND") {
    return CODEX_NOT_FOUND_GUIDANCE;
  }

  if (error === "PROVIDER_NOT_FOUND") {
    return `${getProviderLabel(providerId)} was not found.`;
  }

  return error ?? `${getProviderLabel(providerId)} was not found.`;
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
