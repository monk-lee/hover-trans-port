export const PROVIDER_IDS = ["codex", "claude", "gemini", "opencode", "antigravity"];
export const PROVIDER_SELECTION_IDS = [...PROVIDER_IDS, "auto"];
export const DEFAULT_PROVIDER_ID = "codex";

const PROVIDER_LABELS = {
  codex: "Codex CLI",
  claude: "Claude CLI",
  gemini: "Gemini CLI",
  opencode: "OpenCode CLI",
  antigravity: "Antigravity CLI"
};

const PROVIDER_FALLBACK_MODEL_CATALOGS = {
  codex: {
    provider: "codex",
    defaultModel: "gpt-6-luna",
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
    defaultModel: "haiku",
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
    defaultModel: "gemini-3.5-flash-lite",
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
    defaultModel: "default",
    models: [
      { value: "default", label: "Default (OpenCode CLI)", recommended: true }
    ],
    supportsCustomModel: true,
    source: "fallback"
  },
  antigravity: {
    provider: "antigravity",
    defaultModel: "default",
    models: [
      { value: "default", label: "Default (Antigravity CLI)", recommended: true }
    ],
    supportsCustomModel: false,
    source: "fallback"
  }
};

function isProviderId(value) {
  return PROVIDER_IDS.includes(value);
}

function normalizeProviderSelection(provider) {
  return PROVIDER_SELECTION_IDS.includes(provider)
    ? provider
    : DEFAULT_PROVIDER_ID;
}

function createUnavailableProviderStatus(id, error = "PROVIDER_UNAVAILABLE") {
  return {
    id,
    label: PROVIDER_LABELS[id],
    available: false,
    error
  };
}

export function createFallbackModelCatalog(providerId) {
  return (
    PROVIDER_FALLBACK_MODEL_CATALOGS[providerId] ??
    PROVIDER_FALLBACK_MODEL_CATALOGS[DEFAULT_PROVIDER_ID]
  );
}

function wrapProvider(provider) {
  const unavailableTranslate = async () => {
    const error = new Error("Provider is not available.");
    error.code = "PROVIDER_UNAVAILABLE";
    error.retryable = false;
    throw error;
  };

  return {
    id: provider.id ?? DEFAULT_PROVIDER_ID,
    label: provider.label ?? PROVIDER_LABELS.codex,
    defaultModel: provider.defaultModel ?? createFallbackModelCatalog(provider.id).defaultModel,
    isAvailable:
      typeof provider.isAvailable === "function"
        ? provider.isAvailable.bind(provider)
        : async () => ({ available: true }),
    modelCatalog:
      typeof provider.modelCatalog === "function"
        ? provider.modelCatalog.bind(provider)
        : async () => {
            const catalog = createFallbackModelCatalog(provider.id);
            return { ...catalog, defaultModel: provider.defaultModel ?? catalog.defaultModel };
          },
    translate:
      typeof provider.translate === "function"
        ? provider.translate.bind(provider)
        : unavailableTranslate
  };
}

export class ProviderRegistry {
  constructor({ providers = [], autoProviderId = DEFAULT_PROVIDER_ID } = {}) {
    this.providers = new Map(
      providers.filter(Boolean).map((provider) => {
        const wrapped = wrapProvider(provider);
        return [wrapped.id, wrapped];
      })
    );
    this.autoProviderId = isProviderId(autoProviderId)
      ? autoProviderId
      : DEFAULT_PROVIDER_ID;
  }

  resolveProvider(providerSelection) {
    const requestedProvider = normalizeProviderSelection(providerSelection);
    const providerId =
      requestedProvider === "auto" ? this.autoProviderId : requestedProvider;
    const selectedProvider = this.providers.get(providerId);

    if (!selectedProvider) {
      return {
        ok: false,
        requestedProvider,
        providerId,
        status: createUnavailableProviderStatus(providerId)
      };
    }

    return {
      ok: true,
      requestedProvider,
      providerId,
      selectedProvider
    };
  }

  async getStatusEntries(providerSelection) {
    if (providerSelection !== undefined) {
      const resolved = this.resolveProvider(providerSelection);
      if (!resolved.ok) {
        return [resolved.status];
      }

      const status = await resolved.selectedProvider.isAvailable();
      return [
        {
          id: resolved.providerId,
          label: resolved.selectedProvider.label,
          ...status
        }
      ];
    }

    const entries = [];

    for (const id of PROVIDER_IDS) {
      const provider = this.providers.get(id);
      if (!provider) {
        entries.push(createUnavailableProviderStatus(id));
        continue;
      }

      const status = await provider.isAvailable();
      entries.push({
        id,
        label: provider.label,
        ...status
      });
    }

    return entries;
  }

  async modelCatalog(providerSelection) {
    const resolved = this.resolveProvider(providerSelection);

    if (!resolved.ok) {
      return createFallbackModelCatalog(resolved.providerId);
    }

    return resolved.selectedProvider.modelCatalog();
  }
}

export function createDefaultProviderRegistry({ provider } = {}) {
  return new ProviderRegistry({
    providers: [provider].filter(Boolean),
    autoProviderId: DEFAULT_PROVIDER_ID
  });
}
