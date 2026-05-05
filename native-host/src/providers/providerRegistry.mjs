export const PROVIDER_IDS = ["codex", "claude", "gemini"];
export const PROVIDER_SELECTION_IDS = [...PROVIDER_IDS, "auto"];
export const DEFAULT_PROVIDER_ID = "codex";

const PROVIDER_LABELS = {
  codex: "Codex CLI",
  claude: "Claude CLI",
  gemini: "Gemini CLI"
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
}

export function createDefaultProviderRegistry({ provider } = {}) {
  return new ProviderRegistry({
    providers: [provider].filter(Boolean),
    autoProviderId: DEFAULT_PROVIDER_ID
  });
}
