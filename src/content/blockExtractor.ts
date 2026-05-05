import type { TranslationTarget } from "../shared/messages";
import {
  INLINE_TRANSLATION_SELECTOR,
  serializeElementWithInlineAnnotations
} from "./inlineAnnotations";
import { getSourceElementDescriptor } from "./sourceElement";

const MAX_TEXT_LENGTH = 4000;

function rectToAnchorRect(rect: DOMRect): TranslationTarget["anchorRect"] {
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height
  };
}

function hasContentEditableAncestor(element: Element): boolean {
  let current: Element | null = element;

  while (current) {
    if (current instanceof HTMLElement && current.isContentEditable) {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

export function getHoverBlockTarget(
  element: Element | null
): TranslationTarget | null {
  if (!element) {
    return null;
  }

  if (
    hasContentEditableAncestor(element) ||
    element.closest(
      `script, style, noscript, input, textarea, select, [data-hover-trans-port-bubble], ${INLINE_TRANSLATION_SELECTOR}`
    )
  ) {
    return null;
  }

  const { text, inlineAnnotations } =
    serializeElementWithInlineAnnotations(element);

  if (text.length < 2 || text.length > MAX_TEXT_LENGTH) {
    return null;
  }

  const rect = element.getBoundingClientRect();

  if (rect.width === 0 || rect.height === 0) {
    return null;
  }

  return {
    mode: "hover-block",
    text,
    inlineAnnotations:
      inlineAnnotations.length > 0 ? inlineAnnotations : undefined,
    anchorRect: rectToAnchorRect(rect),
    pageUrl: window.location.href,
    pageTitle: document.title,
    sourceElement: getSourceElementDescriptor(element)
  };
}
