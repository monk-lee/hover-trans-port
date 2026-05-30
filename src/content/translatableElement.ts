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

const FORM_VALUE_SELECTOR = "input, textarea, select, option";
const EXCLUDED_SELECTOR = [
  "script",
  "style",
  "noscript",
  FORM_VALUE_SELECTOR,
  "[data-hover-trans-port-inline]"
].join(",");
const INLINE_SELECTOR = "[data-hover-trans-port-inline]";
const MAX_FALLBACK_TEXT_LENGTH = 4000;
const TEXT_FLOW_INLINE_TAG_NAMES = new Set([
  "A",
  "ABBR",
  "B",
  "CODE",
  "EM",
  "I",
  "KBD",
  "MARK",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP"
]);

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

function isExcludedElement(element: Element): boolean {
  return element.matches(EXCLUDED_SELECTOR);
}

function getNormalizedElementText(element: Element): string {
  return normalizeText(element.textContent ?? "");
}

function hasReadableTextLength(element: Element): boolean {
  const text = getNormalizedElementText(element);

  return text.length >= 2 && text.length <= MAX_FALLBACK_TEXT_LENGTH;
}

function isSafeDirectTextTarget(element: Element): boolean {
  const text = normalizeText(element.textContent ?? "");

  return (
    !isExcludedElement(element) &&
    hasDirectReadableText(element) &&
    text.length >= 2 &&
    text.length <= MAX_FALLBACK_TEXT_LENGTH &&
    !hasNestedSemanticBlocks(element)
  );
}

function shouldDeferInlineTextToAncestor(element: Element): boolean {
  if (!TEXT_FLOW_INLINE_TAG_NAMES.has(element.tagName)) {
    return false;
  }

  const parent = element.parentElement;

  return Boolean(
    parent &&
      !isExcludedElement(parent) &&
      (parent.matches(SEMANTIC_BLOCK_SELECTOR) || hasDirectReadableText(parent))
  );
}

function isSemanticTextTarget(element: Element): boolean {
  return (
    element.matches(SEMANTIC_BLOCK_SELECTOR) &&
    !isExcludedElement(element) &&
    hasReadableTextLength(element)
  );
}

export function findNearestTranslatableElement(
  start: Element
): Element | null {
  if (start.closest(INLINE_SELECTOR) || start.closest(FORM_VALUE_SELECTOR)) {
    return null;
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

    if (isElementVisible(current)) {
      if (
        !shouldDeferInlineTextToAncestor(current) &&
        isSafeDirectTextTarget(current)
      ) {
        return current;
      }

      if (isSemanticTextTarget(current)) {
        return current;
      }
    }

    current = current.parentElement;
  }

  return null;
}
