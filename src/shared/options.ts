import {
  DEFAULT_PROVIDER,
  PROVIDER_DEFAULT_MODELS,
  type ProviderId,
  type ProviderSelection,
  normalizeProvider,
  resolveProviderForModel
} from "./providers";
import {
  DEFAULT_TRIGGER_HOTKEY,
  type TriggerHotkey,
  normalizeTriggerHotkey
} from "./hotkeys";

export const DEFAULT_CODEX_MODEL = PROVIDER_DEFAULT_MODELS.codex;
export const DEFAULT_TIMEOUT_MS = 30000;
export const DEFAULT_YOUTUBE_SUBTITLE_TIMEOUT_MS = 60000;
export const MIN_TIMEOUT_MS = 5000;
export const MAX_TIMEOUT_MS = 120000;
export const DEFAULT_EXTENSION_ENABLED = true;
export const DEFAULT_CACHE_ENABLED = true;
export const DEFAULT_DEBUG_LOGGING = false;
export const DEFAULT_NATIVE_HOST_UPDATE_AUTO_CHECK = true;
export const DEFAULT_TARGET_LANG = "Korean";
export const COMMON_TARGET_LANGUAGES = [
  "Korean",
  "English",
  "Japanese",
  "Chinese",
  "Spanish"
] as const;
export const CUSTOM_TARGET_LANG_VALUE = "__custom__";

export type CommonTargetLanguage = (typeof COMMON_TARGET_LANGUAGES)[number];

const LOCALE_TARGET_LANG_BY_PREFIX: Record<string, CommonTargetLanguage> = {
  ko: "Korean",
  en: "English",
  ja: "Japanese",
  zh: "Chinese",
  es: "Spanish"
};

export type ProviderModelMap = Partial<Record<ProviderId, string>>;

export type HoverTransPortOptions = {
  enabled?: boolean;
  provider?: ProviderSelection;
  codexModel?: string;
  modelsByProvider?: ProviderModelMap;
  targetLang?: string;
  triggerHotkey?: TriggerHotkey;
  timeoutMs?: number;
  youtubeSubtitleTimeoutMs?: number;
  cacheEnabled?: boolean;
  debugLogging?: boolean;
  nativeHostUpdateAutoCheck?: boolean;
};

export type StoredOptions = {
  hoverTransPort?: HoverTransPortOptions;
};

const UNSUPPORTED_PROVIDER_MODELS: Partial<Record<ProviderId, readonly string[]>> = {
  codex: ["gpt-5.4-nano"]
};

export {
  DEFAULT_PROVIDER,
  DEFAULT_TRIGGER_HOTKEY,
  normalizeProvider,
  normalizeTriggerHotkey
};
export type { TriggerHotkey };

export function normalizeCodexModel(model: string | undefined): string {
  const trimmed = model?.trim();
  return trimmed || DEFAULT_CODEX_MODEL;
}

export function normalizeProviderModel(
  provider: ProviderId,
  model: string | undefined,
  fallback = PROVIDER_DEFAULT_MODELS[provider]
): string {
  const trimmed = model?.trim();
  // An empty saved value was the explicit CLI-default option for these providers.
  if (trimmed === "" && ["gemini", "opencode", "antigravity"].includes(provider)) {
    return "default";
  }
  const unsupportedModels = UNSUPPORTED_PROVIDER_MODELS[provider] ?? [];

  if (!trimmed || unsupportedModels.includes(trimmed)) {
    return fallback;
  }

  return trimmed;
}

export function normalizeTargetLang(
  targetLang: string | undefined,
  fallback = DEFAULT_TARGET_LANG
): string {
  const trimmed = targetLang?.trim();

  if (trimmed) {
    return trimmed;
  }

  const normalizedFallback = fallback.trim();
  return normalizedFallback || DEFAULT_TARGET_LANG;
}

export function mapLocaleToTargetLang(
  locale: string | undefined
): CommonTargetLanguage | undefined {
  const prefix = locale?.trim().toLowerCase().split(/[-_]/u)[0];

  if (!prefix) {
    return undefined;
  }

  return LOCALE_TARGET_LANG_BY_PREFIX[prefix];
}

export function getBrowserTargetLang(
  locales: Array<string | undefined> = []
): string {
  for (const locale of locales) {
    const targetLang = mapLocaleToTargetLang(locale);

    if (targetLang) {
      return targetLang;
    }
  }

  return DEFAULT_TARGET_LANG;
}

type ModelOptions = Pick<HoverTransPortOptions, "modelsByProvider" | "codexModel">;

export function getModelForProvider(
  options: ModelOptions | undefined,
  provider: ProviderSelection,
  fallback = PROVIDER_DEFAULT_MODELS[resolveProviderForModel(provider)]
): string {
  const id = resolveProviderForModel(provider);
  const stored = options?.modelsByProvider?.[id]
    ?? (id === "codex" ? options?.codexModel : undefined);
  return normalizeProviderModel(id, stored, fallback);
}

export function createTranslationModelResolver(
  loadDefault: (provider: ProviderId) => Promise<string>
) {
  const defaults = new Map<ProviderId, { expires: number; model: Promise<string> }>();
  return async (options: ModelOptions | undefined, provider: ProviderSelection) => {
    const id = resolveProviderForModel(provider);
    const saved = getModelForProvider(options, id, "");
    if (saved || id === "gemini" || id === "claude") {
      return saved || PROVIDER_DEFAULT_MODELS[id];
    }
    const cached = defaults.get(id);
    if (cached && Date.now() < cached.expires) {
      return cached.model;
    }
    const model = loadDefault(id).catch(() => PROVIDER_DEFAULT_MODELS[id]);
    defaults.set(id, { expires: Date.now() + 60_000, model });
    return model;
  };
}

export function normalizeEnabled(enabled: boolean | undefined): boolean {
  return typeof enabled === "boolean" ? enabled : DEFAULT_EXTENSION_ENABLED;
}

export function normalizeTimeoutMs(timeoutMs: number | string | undefined): number {
  return normalizeTimeoutMsWithFallback(timeoutMs, DEFAULT_TIMEOUT_MS);
}

export function normalizeYouTubeSubtitleTimeoutMs(
  timeoutMs: number | string | undefined
): number {
  return normalizeTimeoutMsWithFallback(
    timeoutMs,
    DEFAULT_YOUTUBE_SUBTITLE_TIMEOUT_MS
  );
}

function normalizeTimeoutMsWithFallback(
  timeoutMs: number | string | undefined,
  fallbackMs: number
): number {
  const rawTimeoutMs =
    typeof timeoutMs === "number" ? timeoutMs : timeoutMs?.trim();

  if (rawTimeoutMs === undefined || rawTimeoutMs === "") {
    return fallbackMs;
  }

  const parsed =
    typeof rawTimeoutMs === "number" ? rawTimeoutMs : Number(rawTimeoutMs);

  if (!Number.isFinite(parsed)) {
    return fallbackMs;
  }

  return Math.min(
    MAX_TIMEOUT_MS,
    Math.max(MIN_TIMEOUT_MS, Math.round(parsed))
  );
}

export function normalizeCacheEnabled(cacheEnabled: boolean | undefined): boolean {
  return typeof cacheEnabled === "boolean"
    ? cacheEnabled
    : DEFAULT_CACHE_ENABLED;
}

export function normalizeDebugLogging(debugLogging: boolean | undefined): boolean {
  return typeof debugLogging === "boolean"
    ? debugLogging
    : DEFAULT_DEBUG_LOGGING;
}

export function normalizeNativeHostUpdateAutoCheck(
  enabled: boolean | undefined
): boolean {
  return typeof enabled === "boolean"
    ? enabled
    : DEFAULT_NATIVE_HOST_UPDATE_AUTO_CHECK;
}
