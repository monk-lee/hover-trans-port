export type YouTubeSubtitleControlState =
  | { status: "prompt" }
  | { status: "loading"; message: string }
  | { status: "enabled" }
  | { status: "disabled" }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

type YouTubeSubtitleControlHandlers = {
  onAccept: () => void;
  onDecline: () => void;
  onToggle: () => void;
};

const CONTROL_ATTRIBUTE = "data-hover-trans-port-youtube-subtitle-control";
const POPOVER_ATTRIBUTE = "data-hover-trans-port-youtube-subtitle-popover";
const STYLE_ID = "hover-trans-port-youtube-subtitle-control-style";

function ensureControlStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .hover-trans-port-youtube-subtitle-control {
      align-items: center;
      box-sizing: border-box;
      color: #fff;
      display: inline-flex;
      font: 700 13px/1 Arial, sans-serif;
      height: 100%;
      justify-content: center;
      min-width: 0;
      opacity: 0.9;
      padding: 0;
      position: relative;
      vertical-align: top;
      white-space: nowrap;
      width: 48px;
    }
    .hover-trans-port-youtube-subtitle-control-icon {
      align-items: center;
      border: 1.5px solid currentColor;
      border-radius: 2px;
      box-sizing: border-box;
      display: inline-flex;
      height: 18px;
      justify-content: center;
      width: 22px;
    }
    .hover-trans-port-youtube-subtitle-control:hover {
      opacity: 1;
    }
    .hover-trans-port-youtube-subtitle-control[disabled] {
      cursor: default;
      opacity: 0.64;
    }
    .hover-trans-port-youtube-subtitle-control[data-hover-trans-port-status="loading"]::before {
      animation: hover-trans-port-youtube-subtitle-spin 0.9s linear infinite;
      border: 2px solid rgba(255, 255, 255, 0.45);
      border-top-color: #fff;
      border-radius: 999px;
      content: "";
      height: 12px;
      width: 12px;
    }
    .hover-trans-port-youtube-subtitle-control[data-hover-trans-port-status="enabled"] {
      color: #3ea6ff;
    }
    .hover-trans-port-youtube-subtitle-control[data-hover-trans-port-status="error"] {
      color: #ffb4b4;
    }
    .hover-trans-port-youtube-subtitle-popover {
      align-items: center;
      background: rgba(18, 18, 18, 0.96);
      border-radius: 4px;
      bottom: 42px;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
      color: #fff;
      display: flex;
      font: 500 12px/1.4 Arial, sans-serif;
      gap: 6px;
      padding: 8px 10px;
      position: absolute;
      right: 0;
      white-space: nowrap;
      z-index: 2147483647;
    }
    .hover-trans-port-youtube-subtitle-popover button {
      background: rgba(255, 255, 255, 0.16);
      border: 0;
      border-radius: 3px;
      color: #fff;
      cursor: pointer;
      font: inherit;
      padding: 3px 7px;
    }
    .hover-trans-port-youtube-subtitle-popover button:hover {
      background: rgba(255, 255, 255, 0.26);
    }
    @keyframes hover-trans-port-youtube-subtitle-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;
  (document.head ?? document.documentElement).appendChild(style);
}

export class YouTubeSubtitleControl {
  private node: HTMLButtonElement | null = null;
  private popover: HTMLElement | null = null;
  private state: YouTubeSubtitleControlState = { status: "disabled" };

  constructor(private readonly handlers: YouTubeSubtitleControlHandlers) {}

  mount(container: Element): void {
    ensureControlStyle();
    const existing = container.querySelector<HTMLButtonElement>(
      `[${CONTROL_ATTRIBUTE}="true"]`
    );
    this.node = existing ?? document.createElement("button");
    this.node.className = "ytp-button hover-trans-port-youtube-subtitle-control";
    this.node.setAttribute(CONTROL_ATTRIBUTE, "true");
    this.node.type = "button";
    this.node.onclick = () => this.handleClick();

    if (!existing) {
      const settings = container.querySelector(".ytp-settings-button");
      container.insertBefore(this.node, settings);
    }

    this.setState(this.state);
  }

  setState(state: YouTubeSubtitleControlState): void {
    this.state = state;

    if (!this.node) {
      return;
    }

    this.node.dataset.hoverTransPortStatus = state.status;
    this.node.setAttribute("data-hover-trans-port-status", state.status);
    this.node.disabled =
      state.status === "loading" || state.status === "unavailable";
    const label =
      state.status === "unavailable" || state.status === "error"
        ? state.message
        : state.status === "loading"
          ? state.message
        : "YouTube 자막 번역";
    this.node.title = label;
    this.node.setAttribute("aria-label", label);
    this.node.replaceChildren();

    if (state.status !== "loading") {
      const icon = document.createElement("span");
      icon.className = "hover-trans-port-youtube-subtitle-control-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "번";
      this.node.appendChild(icon);
    }

    if (state.status !== "prompt") {
      this.hidePopover();
    }
  }

  destroy(): void {
    this.hidePopover();
    this.node?.remove();
    this.node = null;
  }

  private handleClick(): void {
    if (this.state.status === "loading" || this.state.status === "unavailable") {
      return;
    }

    if (this.state.status === "enabled") {
      this.handlers.onToggle();
      return;
    }

    this.showPrompt();
  }

  private showPrompt(): void {
    this.hidePopover();

    const popover = document.createElement("div");
    popover.setAttribute(POPOVER_ATTRIBUTE, "true");
    popover.className = "hover-trans-port-youtube-subtitle-popover notranslate";
    popover.textContent = "자막 번역할까요? ";

    const yes = document.createElement("button");
    yes.type = "button";
    yes.textContent = "예";
    yes.onclick = () => {
      this.hidePopover();
      this.handlers.onAccept();
    };

    const no = document.createElement("button");
    no.type = "button";
    no.textContent = "아니오";
    no.onclick = () => {
      this.hidePopover();
      this.handlers.onDecline();
    };

    popover.append(yes, no);
    this.node?.after(popover);
    this.popover = popover;
  }

  private hidePopover(): void {
    this.popover?.remove();
    this.popover = null;
  }
}
