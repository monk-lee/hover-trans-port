import type { SourceElement } from "../shared/messages";
import { findNearestTranslatableElement } from "./translatableElement";

const SOURCE_KEY_ATTRIBUTE = "data-hover-trans-port-source-key";
const SOURCE_KEY_PREFIX = "hover-trans-port-source";
let nextSourceKey = 1;

export function getSourceElementDescriptor(element: Element): SourceElement {
  const htmlElement = element as HTMLElement;
  let ownerKey = htmlElement.getAttribute(SOURCE_KEY_ATTRIBUTE);

  if (!ownerKey) {
    ownerKey = `${SOURCE_KEY_PREFIX}-${nextSourceKey}`;
    nextSourceKey += 1;
    htmlElement.setAttribute(SOURCE_KEY_ATTRIBUTE, ownerKey);
  }

  return {
    ownerKey,
    tagName: element.tagName.toLowerCase(),
    renderStrategy: "inside-source"
  };
}

export function findSourceElementByOwnerKey(ownerKey: string): Element | null {
  return document.querySelector(
    `[${SOURCE_KEY_ATTRIBUTE}="${CSS.escape(ownerKey)}"]`
  );
}

export function findNearestSourceBlock(node: Node): Element | null {
  const element =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;

  return element ? findNearestTranslatableElement(element) : null;
}
