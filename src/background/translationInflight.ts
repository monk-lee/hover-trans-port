import type { ProviderSelection } from "../shared/providers";

export type TranslationInflightKeyInput = {
  provider: ProviderSelection;
  model: string;
  sourceLang: string;
  targetLang: string;
  text: string;
  cacheEnabled?: boolean;
};

function normalizeDimension(value: string, fallback: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeText(text: string): string {
  return text.trim().split(/\s+/u).filter(Boolean).join(" ");
}

export function createTranslationInflightKey(
  input: TranslationInflightKeyInput
): string {
  return JSON.stringify({
    provider: input.provider,
    model: normalizeDimension(input.model, "default"),
    sourceLang: normalizeDimension(input.sourceLang, "auto"),
    targetLang: normalizeDimension(input.targetLang, "ko"),
    text: normalizeText(input.text),
    cacheEnabled: input.cacheEnabled ?? true
  });
}

export class TranslationInflightRegistry<T> {
  private readonly requests = new Map<string, Promise<T>>();

  get size(): number {
    return this.requests.size;
  }

  run(
    key: string,
    task: () => Promise<T>,
    onJoin?: (request: Promise<T>) => void
  ): Promise<T> {
    const existing = this.requests.get(key);

    if (existing) {
      onJoin?.(existing);
      return existing;
    }

    const request = task().finally(() => {
      if (this.requests.get(key) === request) {
        this.requests.delete(key);
      }
    });

    this.requests.set(key, request);
    return request;
  }
}
