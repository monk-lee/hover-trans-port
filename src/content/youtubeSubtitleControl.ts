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
      line-height: 0;
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
      box-sizing: border-box;
      color: #fff;
      display: flex;
      height: 100%;
      justify-content: center;
      pointer-events: none;
      visibility: visible;
      width: 100%;
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
  private renderedStateKey: string | null = null;

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
      this.renderedStateKey = null;
    }

    if (container.firstElementChild !== this.node) {
      container.insertBefore(this.node, container.firstElementChild);
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
    this.node.disabled = state.status === "loading";
    const label =
      state.status === "unavailable" || state.status === "error"
        ? state.message
        : state.status === "loading"
          ? state.message
        : "YouTube 자막 번역";
    const nextStateKey = `${state.status}:${label}`;

    if (this.renderedStateKey === nextStateKey) {
      return;
    }

    this.renderedStateKey = nextStateKey;
    this.node.title = label;
    this.node.setAttribute("aria-label", label);
    this.node.replaceChildren();

    if (state.status !== "loading") {
      this.node.appendChild(createTranslationIcon());
    }

    if (state.status !== "prompt") {
      this.hidePopover();
    }
  }

  destroy(): void {
    this.hidePopover();
    this.node?.remove();
    this.node = null;
    this.renderedStateKey = null;
  }

  private handleClick(): void {
    if (this.state.status === "loading") {
      return;
    }

    if (this.state.status === "enabled") {
      this.handlers.onToggle();
      return;
    }

    if (this.state.status === "unavailable" || this.state.status === "error") {
      this.showMessage(this.state.message);
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

  private showMessage(message: string): void {
    this.hidePopover();

    const popover = document.createElement("div");
    popover.setAttribute(POPOVER_ATTRIBUTE, "true");
    popover.className = "hover-trans-port-youtube-subtitle-popover notranslate";
    popover.textContent = `${message} `;

    const ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = "확인";
    ok.onclick = () => this.hidePopover();

    popover.append(ok);
    this.node?.after(popover);
    this.popover = popover;
  }

  private hidePopover(): void {
    this.popover?.remove();
    this.popover = null;
  }
}

function createTranslationIcon(): HTMLDivElement {
  const namespace = "http://www.w3.org/2000/svg";
  const wrapper = document.createElement("div");
  wrapper.className =
    "ytp-subtitles-button-icon hover-trans-port-youtube-subtitle-control-icon";
  wrapper.setAttribute("fill-opacity", "1");

  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("fill", "none");
  svg.setAttribute("height", "24");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "24");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS(namespace, "path");
  path.setAttribute(
    "d",
    "M21.20 3.01L21 3H3L2.79 3.01C2.30 3.06 1.84 3.29 1.51 3.65C1.18 4.02 .99 4.50 1 5V19L1.01 19.20C1.05 19.66 1.26 20.08 1.58 20.41C1.91 20.73 2.33 20.94 2.79 20.99L3 21H21L21.20 20.98C21.66 20.94 22.08 20.73 22.41 20.41C22.73 20.08 22.94 19.66 22.99 19.20L23 19V5C23.00 4.50 22.81 4.02 22.48 3.65C22.15 3.29 21.69 3.06 21.20 3.01ZM3 19V5H21V19H3ZM8 11H6C5.73 11 5.48 11.10 5.29 11.29C5.10 11.48 5 11.73 5 12C5 12.26 5.10 12.51 5.29 12.70C5.48 12.89 5.73 13 6 13H8C8.26 13 8.51 12.89 8.70 12.70C8.89 12.51 9 12.26 9 12C9 11.73 8.89 11.48 8.70 11.29C8.51 11.10 8.26 11 8 11ZM18 11H12C11.73 11 11.48 11.10 11.29 11.29C11.10 11.48 11 11.73 11 12C11 12.26 11.10 12.51 11.29 12.70C11.48 12.89 11.73 13 12 13H18C18.26 13 18.51 12.89 18.70 12.70C18.89 12.51 19 12.26 19 12C19 11.73 18.89 11.48 18.70 11.29C18.51 11.10 18.26 11 18 11ZM18 15H16C15.73 15 15.48 15.10 15.29 15.29C15.10 15.48 15 15.73 15 16C15 16.26 15.10 16.51 15.29 16.70C15.48 16.89 15.73 17 16 17H18C18.26 17 18.51 16.89 18.70 16.70C18.89 16.51 19 16.26 19 16C19 15.73 18.89 15.48 18.70 15.29C18.51 15.10 18.26 15 18 15ZM12 15H6C5.73 15 5.48 15.10 5.29 15.29C5.10 15.48 5 15.73 5 16C5 16.26 5.10 16.51 5.29 16.70C5.48 16.89 5.73 17 6 17H12C12.26 17 12.51 16.89 12.70 16.70C12.89 16.51 13 16.26 13 16C13 15.73 12.89 15.48 12.70 15.29C12.51 15.10 12.26 15 12 15Z"
  );
  path.setAttribute("fill", "white");
  svg.appendChild(path);
  wrapper.appendChild(svg);

  return wrapper;
}
