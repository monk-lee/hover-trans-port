export const PROVIDER_IDS = ["codex", "claude", "gemini", "antigravity"];
export const PROVIDER_SELECTION_IDS = [...PROVIDER_IDS, "auto"];
export const DEFAULT_PROVIDER_ID = "codex";

const PROVIDER_LABELS = {
  codex: "Codex CLI",
  claude: "Claude CLI",
  gemini: "Gemini CLI",
  antigravity: "Antigravity CLI"
};

const PROVIDER_FALLBACK_MODEL_CATALOGS = {
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
  antigravity: {
    provider: "antigravity",
    defaultModel: "",
    models: [
      { value: "", label: "Default (Antigravity CLI)", recommended: true }
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
    defaultModel: provider.defaultModel ?? "gpt-5.4-mini",
    isAvailable:
      typeof provider.isAvailable === "function"
        ? provider.isAvailable.bind(provider)
        : async () => ({ available: true }),
    modelCatalog:
      typeof provider.modelCatalog === "function"
        ? provider.modelCatalog.bind(provider)
        : async () => createFallbackModelCatalog(provider.id ?? DEFAULT_PROVIDER_ID),
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

  async getStatusEntries() {
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
