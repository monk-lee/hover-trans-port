import type { InlineAnnotation, InlineAnnotationKind } from "../shared/messages";

export const INLINE_MARKER_PREFIX = "HTP_INLINE";
export const INLINE_TRANSLATION_SELECTOR = "[data-hover-trans-port-inline]";

export const SUPPORTED_INLINE_TAGS = new Set([
  "A",
  "CODE",
  "STRONG",
  "B",
  "EM",
  "I",
  "KBD",
  "MARK",
  "SUP",
  "SUB"
]);

export type SerializedInlineContent = {
  text: string;
  inlineAnnotations: InlineAnnotation[];
};

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripInlineMarkers(text: string): string {
  return text.replace(/\[\/?HTP_INLINE_\d+\]/g, "");
}

function isSupportedInlineElement(
  element: Element
): element is HTMLElement {
  if (!SUPPORTED_INLINE_TAGS.has(element.tagName)) {
    return false;
  }

  return element instanceof HTMLElement;
}

function getInlineKind(element: Element): InlineAnnotationKind {
  return element.tagName.toLowerCase() as InlineAnnotationKind;
}

function createAnnotation(
  element: HTMLElement,
  id: string,
  text: string
): InlineAnnotation {
  const kind = getInlineKind(element);
  const annotation: InlineAnnotation = {
    id,
    kind,
    text,
    className: element.className || undefined,
    styleText: element.getAttribute("style") ?? undefined
  };

  if (kind === "a" && element instanceof HTMLAnchorElement) {
    annotation.href = element.href;
    annotation.target = element.getAttribute("target") ?? undefined;
    annotation.rel = element.getAttribute("rel") ?? undefined;
  }

  return annotation;
}

export function serializeElementWithInlineAnnotations(
  element: Element
): SerializedInlineContent {
  const inlineAnnotations: InlineAnnotation[] = [];

  function serializeNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? "";
    }

    if (!(node instanceof Element)) {
      return "";
    }

    if (node.matches(INLINE_TRANSLATION_SELECTOR)) {
      return "";
    }

    if (!isSupportedInlineElement(node)) {
      return Array.from(node.childNodes)
        .map((child) => serializeNode(child))
        .join("");
    }

    const id = String(inlineAnnotations.length + 1);
    const annotationIndex = inlineAnnotations.length;
    inlineAnnotations.push(createAnnotation(node, id, ""));

    const serializedChildren = Array.from(node.childNodes)
      .map((child) => serializeNode(child))
      .join("");
    const visibleText = normalizeText(stripInlineMarkers(serializedChildren));

    if (!visibleText) {
      inlineAnnotations.splice(annotationIndex, 1);
      return serializedChildren;
    }

    inlineAnnotations[annotationIndex] = createAnnotation(node, id, visibleText);

    return `[${INLINE_MARKER_PREFIX}_${id}]${serializedChildren}[/${INLINE_MARKER_PREFIX}_${id}]`;
  }

  return {
    text: normalizeText(serializeNode(element)),
    inlineAnnotations
  };
}
