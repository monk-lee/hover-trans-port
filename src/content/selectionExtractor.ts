import type { TranslationTarget } from "../shared/messages";
import {
  findNearestSourceBlock,
  getSourceElementDescriptor
} from "./sourceElement";

const MAX_TEXT_LENGTH = 4000;
const BLOCKED_ELEMENT_SELECTOR =
  "script, style, noscript, input, textarea, select, [data-hover-trans-port-inline]";

function rectToAnchorRect(rect: DOMRect): TranslationTarget["anchorRect"] {
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height
  };
}

function isInsideBlockedElement(node: Node): boolean {
  let element: Element | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;

  while (element) {
    if (isBlockedElement(element)) {
      return true;
    }

    element = element.parentElement;
  }

  return false;
}

function isBlockedElement(element: Element): boolean {
  return (
    element.matches(BLOCKED_ELEMENT_SELECTOR) ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

function rangeIntersectsBlockedElement(range: Range): boolean {
  const root = range.commonAncestorContainer;

  if (root.nodeType === Node.ELEMENT_NODE && isBlockedElement(root as Element)) {
    return true;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let current = walker.nextNode();

  while (current) {
    if (
      current instanceof Element &&
      isBlockedElement(current) &&
      range.intersectsNode(current)
    ) {
      return true;
    }

    current = walker.nextNode();
  }

  return false;
}

export function getSelectionTarget(): TranslationTarget | null {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const text = selection.toString().replace(/\s+/g, " ").trim();

  if (text.length < 2 || text.length > MAX_TEXT_LENGTH) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const sourceElement = findNearestSourceBlock(range.commonAncestorContainer);

  if (!sourceElement) {
    return null;
  }

  if (
    isInsideBlockedElement(range.startContainer) ||
    isInsideBlockedElement(range.endContainer) ||
    rangeIntersectsBlockedElement(range)
  ) {
    return null;
  }

  const rect = range.getBoundingClientRect();

  if (rect.width === 0 && rect.height === 0) {
    return null;
  }

  return {
    mode: "selection",
    text,
    anchorRect: rectToAnchorRect(rect),
    pageUrl: window.location.href,
    pageTitle: document.title,
    sourceElement: getSourceElementDescriptor(sourceElement)
  };
}
