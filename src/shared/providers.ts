export const PROVIDER_IDS = ["codex", "claude", "gemini"] as const;
export const AUTO_PROVIDER = "auto" as const;
export const PROVIDER_SELECTION_IDS = [...PROVIDER_IDS, AUTO_PROVIDER] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];
export type ProviderSelection = (typeof PROVIDER_SELECTION_IDS)[number];
export type ProviderModelOption = {
  value: string;
  label: string;
};

export const DEFAULT_PROVIDER: ProviderId = "codex";

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  codex: "Codex CLI",
  claude: "Claude CLI",
  gemini: "Gemini CLI"
};

export const PROVIDER_DEFAULT_MODELS: Record<ProviderId, string> = {
  codex: "gpt-5.4-mini",
  claude: "haiku",
  gemini: ""
};

export const PROVIDER_MODEL_OPTIONS: Record<ProviderId, ProviderModelOption[]> = {
  codex: [
    { value: "gpt-5.4-mini", label: "Fast (GPT-5.4 Mini)" },
    { value: "gpt-5.4-nano", label: "Fastest (GPT-5.4 Nano)" },
    { value: "gpt-5.4", label: "Balanced (GPT-5.4)" },
    { value: "gpt-5.5", label: "Best (GPT-5.5)" }
  ],
  claude: [
    { value: "haiku", label: "Fast (Haiku)" },
    { value: "sonnet", label: "Balanced (Sonnet)" },
    { value: "opus", label: "Best (Opus)" },
    { value: "default", label: "Default (Claude CLI)" }
  ],
  gemini: []
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

export function getModelOptionsForProvider(
  provider: ProviderId
): ProviderModelOption[] {
  return PROVIDER_MODEL_OPTIONS[provider];
}
