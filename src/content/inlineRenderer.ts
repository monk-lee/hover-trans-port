import type { InlineAnnotation, TranslationTarget } from "../shared/messages";
import { createInlineMarkerFragment } from "./inlineMarkerRenderer";
import { findSourceElementByOwnerKey } from "./sourceElement";

const INLINE_ATTRIBUTE = "data-hover-trans-port-inline";
const INLINE_OWNER_ATTRIBUTE = "data-hover-trans-port-owner";
const INLINE_TEXT_ATTRIBUTE = "data-hover-trans-port-inline-text";
const INLINE_STATUS_ATTRIBUTE = "data-hover-trans-port-status";
const INLINE_LOADER_ATTRIBUTE = "data-hover-trans-port-loader";
const INLINE_LINE_BREAK_ATTRIBUTE = "data-hover-trans-port-line-break";
const INLINE_HIDDEN_ATTRIBUTE = "data-hover-trans-port-hidden";
const LOADER_STYLE_ID = "hover-trans-port-inline-loader-style";

export type InlineRenderState =
  | {
      status: "loading";
      text: string;
    }
  | {
      status: "success";
      text: string;
    }
  | {
      status: "error";
      text: string;
    };

export type InlineRenderedStatus = InlineRenderState["status"] | "hidden";

export type InlineToggleResult = "shown" | "hidden" | false;

function findExistingInline(ownerKey: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[${INLINE_ATTRIBUTE}="true"][${INLINE_OWNER_ATTRIBUTE}="${CSS.escape(ownerKey)}"]`
  );
}

function createInlineNode(ownerKey: string): HTMLElement {
  const node = document.createElement("font");
  node.setAttribute(INLINE_ATTRIBUTE, "true");
  node.setAttribute(INLINE_OWNER_ATTRIBUTE, ownerKey);
  node.className = "notranslate";
  node.lang = "ko";
  return node;
}

function createLineBreakNode(): HTMLBRElement {
  const lineBreak = document.createElement("br");
  lineBreak.setAttribute(INLINE_LINE_BREAK_ATTRIBUTE, "true");
  return lineBreak;
}

function ensureLoaderStyle(): void {
  if (document.getElementById(LOADER_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = LOADER_STYLE_ID;
  style.textContent = `
    [${INLINE_LOADER_ATTRIBUTE}="true"] {
      display: inline-flex;
      align-items: center;
      justify-content: flex-start;
      gap: 0.22em;
      min-width: 1.55em;
      vertical-align: baseline;
    }

    [${INLINE_LOADER_ATTRIBUTE}="true"] > span {
      display: inline-block;
      width: 0.34em;
      height: 0.34em;
      border-radius: 999px;
      background-color: currentColor;
      opacity: 0.32;
      animation: hover-trans-port-loading-dot 1s ease-in-out infinite;
    }

    [${INLINE_LOADER_ATTRIBUTE}="true"] > span:nth-child(2) {
      animation-delay: 0.14s;
    }

    [${INLINE_LOADER_ATTRIBUTE}="true"] > span:nth-child(3) {
      animation-delay: 0.28s;
    }

    @keyframes hover-trans-port-loading-dot {
      0%, 80%, 100% {
        opacity: 0.28;
        transform: translateY(0);
      }

      40% {
        opacity: 0.86;
        transform: translateY(-0.12em);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      [${INLINE_LOADER_ATTRIBUTE}="true"] > span {
        animation: none;
        opacity: 0.56;
      }
    }
  `;
  document.documentElement.appendChild(style);
}

function createTranslatedTextNode(
  state: InlineRenderState,
  inlineAnnotations: InlineAnnotation[] = []
): HTMLElement {
  const textNode = document.createElement("font");
  textNode.className = "notranslate";
  textNode.setAttribute(INLINE_TEXT_ATTRIBUTE, "true");

  if (state.status !== "success" || inlineAnnotations.length === 0) {
    textNode.textContent = state.text;
    return textNode;
  }

  textNode.appendChild(
    createInlineMarkerFragment(state.text, inlineAnnotations)
  );

  return textNode;
}

function createLoaderNode(): HTMLElement {
  ensureLoaderStyle();

  const loader = document.createElement("font");
  loader.className = "notranslate";
  loader.setAttribute(INLINE_LOADER_ATTRIBUTE, "true");
  loader.setAttribute("role", "status");
  loader.setAttribute("aria-label", "Translating");

  for (let index = 0; index < 3; index += 1) {
    const dot = document.createElement("span");
    dot.setAttribute("aria-hidden", "true");
    loader.appendChild(dot);
  }

  return loader;
}

function setInlineText(
  node: HTMLElement,
  state: InlineRenderState,
  inlineAnnotations?: InlineAnnotation[]
): void {
  node.setAttribute(INLINE_STATUS_ATTRIBUTE, state.status);
  node.removeAttribute(INLINE_HIDDEN_ATTRIBUTE);
  node.hidden = false;

  if (state.status === "loading") {
    node.replaceChildren(createLineBreakNode(), createLoaderNode());
    return;
  }

  node.replaceChildren(
    createLineBreakNode(),
    createTranslatedTextNode(state, inlineAnnotations)
  );
}

function insertInlineNode(target: TranslationTarget, node: HTMLElement): boolean {
  const sourceElement = findSourceElementByOwnerKey(
    target.sourceElement.ownerKey
  );

  if (!sourceElement) {
    return false;
  }

  sourceElement.appendChild(node);
  return true;
}

export class InlineRenderer {
  getRenderedStatus(target: TranslationTarget): InlineRenderedStatus | null {
    const node = findExistingInline(target.sourceElement.ownerKey);

    if (!node) {
      return null;
    }

    const status = node.getAttribute(INLINE_STATUS_ATTRIBUTE);

    if (status === "success" && node.hidden) {
      return "hidden";
    }

    if (status === "loading" || status === "success" || status === "error") {
      return status;
    }

    return null;
  }

  hasSourceElement(target: TranslationTarget): boolean {
    return Boolean(findSourceElementByOwnerKey(target.sourceElement.ownerKey));
  }

  toggleRenderedResult(target: TranslationTarget): InlineToggleResult {
    if (target.mode !== "hover-block") {
      return false;
    }

    const node = findExistingInline(target.sourceElement.ownerKey);

    if (!node || node.getAttribute(INLINE_STATUS_ATTRIBUTE) !== "success") {
      return false;
    }

    if (node.hidden) {
      node.hidden = false;
      node.removeAttribute(INLINE_HIDDEN_ATTRIBUTE);
      return "shown";
    }

    node.hidden = true;
    node.setAttribute(INLINE_HIDDEN_ATTRIBUTE, "true");
    return "hidden";
  }

  renderState(target: TranslationTarget, state: InlineRenderState): boolean {
    const ownerKey = target.sourceElement.ownerKey;
    const existing = findExistingInline(ownerKey);
    const node = existing ?? createInlineNode(ownerKey);

    setInlineText(node, state, target.inlineAnnotations);

    if (existing) {
      return true;
    }

    return insertInlineNode(target, node);
  }

  render(target: TranslationTarget, translatedText: string): boolean {
    return this.renderSuccess(target, translatedText);
  }

  renderLoading(target: TranslationTarget): boolean {
    return this.renderState(target, {
      status: "loading",
      text: ""
    });
  }

  renderSuccess(target: TranslationTarget, translatedText: string): boolean {
    return this.renderState(target, {
      status: "success",
      text: translatedText
    });
  }

  renderError(target: TranslationTarget, message: string): boolean {
    return this.renderState(target, {
      status: "error",
      text: message
    });
  }
}
