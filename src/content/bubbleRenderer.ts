import type { AnchorRect } from "../shared/messages";

type BubbleState =
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

const BUBBLE_ID = "hover-trans-port-bubble";
const STYLE_ID = "hover-trans-port-bubble-style";

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${BUBBLE_ID} {
      position: fixed;
      box-sizing: border-box;
      z-index: 2147483647;
      max-width: min(420px, calc(100vw - 24px));
      max-height: calc(100vh - 20px);
      padding: 10px 12px;
      border-radius: 8px;
      background: #171717;
      color: #f8fafc;
      font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      overflow-y: auto;
    }

    #${BUBBLE_ID}[data-state="error"] {
      background: #7f1d1d;
    }

    #${BUBBLE_ID}[data-state="loading"] {
      color: #d4d4d4;
    }
  `;
  document.documentElement.appendChild(style);
}

function removeExistingBubble(): void {
  const bubble = document.getElementById(BUBBLE_ID);
  if (bubble?.dataset.hoverTransPortBubble === "true") {
    bubble.remove();
  }
}

function getInitialBubblePosition(anchorRect: AnchorRect): { top: number; left: number } {
  const margin = 10;

  return {
    top: Math.max(margin, anchorRect.top + anchorRect.height + margin),
    left: Math.max(margin, anchorRect.left),
  };
}

function getBubblePosition(anchorRect: AnchorRect, bubbleRect: DOMRect): { top: number; left: number } {
  const margin = 10;
  const belowTop = anchorRect.top + anchorRect.height + margin;
  const aboveTop = anchorRect.top - bubbleRect.height - margin;
  const maxTop = Math.max(margin, window.innerHeight - bubbleRect.height - margin);
  const maxLeft = Math.max(margin, window.innerWidth - bubbleRect.width - margin);
  const belowOverflows = belowTop + bubbleRect.height > window.innerHeight - margin;
  const top =
    belowOverflows && aboveTop >= margin
      ? aboveTop
      : Math.min(maxTop, Math.max(margin, belowTop));

  return {
    top,
    left: Math.min(maxLeft, Math.max(margin, anchorRect.left)),
  };
}

export class BubbleRenderer {
  private cleanupOutsideClick: (() => void) | null = null;
  private cleanupEscape: (() => void) | null = null;
  private pendingHandlerTimeout: ReturnType<typeof setTimeout> | null = null;

  show(anchorRect: AnchorRect, state: BubbleState): void {
    ensureStyle();
    this.dismiss();

    const bubble = document.createElement("div");
    const initialPosition = getInitialBubblePosition(anchorRect);

    bubble.id = BUBBLE_ID;
    bubble.dataset.hoverTransPortBubble = "true";
    bubble.dataset.state = state.status;
    bubble.textContent = state.text;
    bubble.style.top = `${initialPosition.top}px`;
    bubble.style.left = `${initialPosition.left}px`;

    document.documentElement.appendChild(bubble);

    const position = getBubblePosition(anchorRect, bubble.getBoundingClientRect());
    bubble.style.top = `${position.top}px`;
    bubble.style.left = `${position.left}px`;

    this.installDismissHandlers(bubble);
  }

  dismiss(): void {
    if (this.pendingHandlerTimeout !== null) {
      clearTimeout(this.pendingHandlerTimeout);
      this.pendingHandlerTimeout = null;
    }
    this.cleanupOutsideClick?.();
    this.cleanupEscape?.();
    this.cleanupOutsideClick = null;
    this.cleanupEscape = null;
    removeExistingBubble();
  }

  private installDismissHandlers(bubble: HTMLElement): void {
    const handlePointerDown = (event: PointerEvent): void => {
      if (!bubble.contains(event.target as Node)) {
        this.dismiss();
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        this.dismiss();
      }
    };

    this.pendingHandlerTimeout = setTimeout(() => {
      this.pendingHandlerTimeout = null;
      if (!bubble.isConnected) {
        return;
      }

      document.addEventListener("pointerdown", handlePointerDown, true);
      document.addEventListener("keydown", handleKeyDown, true);
    }, 0);

    this.cleanupOutsideClick = () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
    this.cleanupEscape = () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }
}
