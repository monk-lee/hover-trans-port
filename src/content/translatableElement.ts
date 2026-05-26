const SEMANTIC_BLOCK_SELECTOR = [
  "p",
  "li",
  "blockquote",
  "td",
  "th",
  "h1",
  "h2",
  "h3",
  "h4"
].join(",");

const FALLBACK_TAG_NAMES = new Set(["DIV", "SECTION", "ARTICLE", "SPAN"]);
const INLINE_SELECTOR = "[data-hover-trans-port-inline]";
const MAX_FALLBACK_TEXT_LENGTH = 4000;

export function isElementVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none"
  );
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function hasDirectReadableText(element: Element): boolean {
  let directText = "";

  element.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      directText += node.textContent ?? "";
    }
  });

  return normalizeText(directText).length >= 2;
}

function hasNestedSemanticBlocks(element: Element): boolean {
  return element.querySelector(SEMANTIC_BLOCK_SELECTOR) !== null;
}

function isSafeFallbackContainer(element: Element): boolean {
  const text = normalizeText(element.textContent ?? "");

  return (
    FALLBACK_TAG_NAMES.has(element.tagName) &&
    hasDirectReadableText(element) &&
    text.length >= 2 &&
    text.length <= MAX_FALLBACK_TEXT_LENGTH &&
    !hasNestedSemanticBlocks(element)
  );
}

export function findNearestTranslatableElement(
  start: Element
): Element | null {
  const semantic = start.closest(SEMANTIC_BLOCK_SELECTOR);

  if (semantic && isElementVisible(semantic)) {
    return semantic;
  }

  let current: Element | null = start;

  while (
    current &&
    current !== document.body &&
    current !== document.documentElement
  ) {
    if (current.closest(INLINE_SELECTOR)) {
      return null;
    }

    if (isElementVisible(current) && isSafeFallbackContainer(current)) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}
