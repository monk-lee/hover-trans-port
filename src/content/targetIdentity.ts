import type { TranslationTarget } from "../shared/messages";
import { findSourceElementByOwnerKey } from "./sourceElement";

function normalizeTargetText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function createTextHash(text: string): string {
  const normalized = normalizeTargetText(text);
  let hash = 2166136261;

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `${normalized.length}:${(hash >>> 0).toString(36)}`;
}

export function getTargetKey(target: TranslationTarget): string {
  if (target.mode === "selection") {
    return `selection:${target.sourceElement.ownerKey}:${createTextHash(
      target.text
    )}`;
  }

  return target.sourceElement.ownerKey;
}

export function hasTargetSourceElement(target: TranslationTarget): boolean {
  return Boolean(findSourceElementByOwnerKey(target.sourceElement.ownerKey));
}
