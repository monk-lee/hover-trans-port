export type YouTubeSubtitlePromptState =
  | { status: "hidden" }
  | { status: "prompt"; targetLang: string }
  | { status: "loading"; message: string }
  | { status: "error"; message: string };

type YouTubeSubtitlePromptHandlers = {
  onAccept: () => void;
  onDecline: () => void;
};

const PROMPT_ATTRIBUTE = "data-hover-trans-port-youtube-subtitle-prompt";
const STYLE_ID = "hover-trans-port-youtube-subtitle-prompt-style";
const TARGET_LANGUAGE_LABELS: Record<string, string> = {
  chinese: "중국어",
  english: "영어",
  japanese: "일본어",
  korean: "한국어",
  spanish: "스페인어"
};
const PROMPT_COPY_BY_TARGET_LANGUAGE: Record<
  string,
  { message: string; accept: string; decline: string }
> = {
  chinese: {
    message: "要将这些字幕翻译成中文吗？",
    accept: "是",
    decline: "否"
  },
  english: {
    message: "Translate these subtitles to English?",
    accept: "Yes",
    decline: "No"
  },
  japanese: {
    message: "この字幕を日本語に翻訳しますか？",
    accept: "はい",
    decline: "いいえ"
  },
  korean: {
    message: "이 자막을 한국어로 번역할까요?",
    accept: "예",
    decline: "아니오"
  },
  spanish: {
    message: "¿Traducir estos subtítulos al español?",
    accept: "Sí",
    decline: "No"
  }
};

function ensurePromptStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .hover-trans-port-youtube-subtitle-prompt {
      align-items: center;
      background: rgba(18, 18, 18, 0.96);
      border-radius: 4px;
      bottom: 72px;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
      box-sizing: border-box;
      color: #fff;
      display: flex;
      font: 500 12px/1.4 Arial, sans-serif;
      gap: 8px;
      max-width: min(420px, calc(100% - 48px));
      padding: 8px 10px;
      position: absolute;
      right: clamp(16px, 3vw, 36px);
      white-space: normal;
      z-index: 2147483647;
    }
    .hover-trans-port-youtube-subtitle-prompt[hidden] {
      display: none !important;
    }
    .hover-trans-port-youtube-subtitle-prompt-message {
      overflow-wrap: anywhere;
    }
    .hover-trans-port-youtube-subtitle-prompt-actions {
      display: flex;
      flex: 0 0 auto;
      gap: 6px;
    }
    .hover-trans-port-youtube-subtitle-prompt button {
      background: rgba(255, 255, 255, 0.16);
      border: 0;
      border-radius: 3px;
      color: #fff;
      cursor: pointer;
      font: inherit;
      padding: 3px 7px;
    }
    .hover-trans-port-youtube-subtitle-prompt button:hover {
      background: rgba(255, 255, 255, 0.26);
    }
    .hover-trans-port-youtube-subtitle-prompt-spinner {
      flex: 0 0 auto;
      height: 16px;
      width: 16px;
    }
    .hover-trans-port-youtube-subtitle-prompt-spinner-track {
      opacity: 0.35;
    }
    .hover-trans-port-youtube-subtitle-prompt-spinner-head {
      opacity: 1;
    }
  `;
  (document.head ?? document.documentElement).appendChild(style);
}

export class YouTubeSubtitlePrompt {
  private node: HTMLElement | null = null;
  private state: YouTubeSubtitlePromptState = { status: "hidden" };
  private renderedStateKey: string | null = null;

  constructor(private readonly handlers: YouTubeSubtitlePromptHandlers) {}

  mount(playerRoot: Element): void {
    ensurePromptStyle();
    const existing = playerRoot.querySelector<HTMLElement>(
      `[${PROMPT_ATTRIBUTE}="true"]`
    );
    this.node = existing ?? document.createElement("div");
    this.node.className =
      "hover-trans-port-youtube-subtitle-prompt notranslate";
    this.node.setAttribute(PROMPT_ATTRIBUTE, "true");

    if (!existing) {
      playerRoot.appendChild(this.node);
      this.renderedStateKey = null;
    }

    this.setState(this.state);
  }

  setState(state: YouTubeSubtitlePromptState): void {
    this.state = state;

    if (!this.node) {
      return;
    }

    this.node.setAttribute("data-hover-trans-port-status", state.status);
    this.node.hidden = state.status === "hidden";
    const promptCopy =
      state.status === "prompt" ? getPromptCopy(state.targetLang) : null;
    const message =
      state.status === "prompt"
        ? promptCopy?.message ?? ""
        : state.status === "hidden"
          ? ""
          : state.message;
    const nextStateKey = `${state.status}:${message}`;

    if (this.renderedStateKey === nextStateKey) {
      return;
    }

    this.renderedStateKey = nextStateKey;
    this.node.replaceChildren();

    if (state.status === "hidden") {
      return;
    }

    if (state.status === "loading") {
      this.node.appendChild(createLoadingSpinner());
    }

    const messageNode = document.createElement("span");
    messageNode.className = "hover-trans-port-youtube-subtitle-prompt-message";
    messageNode.textContent = message;
    this.node.appendChild(messageNode);

    if (state.status === "prompt") {
      this.node.appendChild(this.createActions(promptCopy));
    }
  }

  destroy(): void {
    this.node?.remove();
    this.node = null;
    this.renderedStateKey = null;
  }

  private createActions(copy: { accept: string; decline: string } | null): HTMLElement {
    const actions = document.createElement("span");
    actions.className = "hover-trans-port-youtube-subtitle-prompt-actions";

    const yes = document.createElement("button");
    yes.type = "button";
    yes.textContent = copy?.accept ?? "예";
    yes.onclick = () => {
      this.setState({ status: "hidden" });
      this.handlers.onAccept();
    };

    const no = document.createElement("button");
    no.type = "button";
    no.textContent = copy?.decline ?? "아니오";
    no.onclick = () => {
      this.setState({ status: "hidden" });
      this.handlers.onDecline();
    };

    actions.append(yes, no);
    return actions;
  }
}

function getPromptCopy(targetLang: string): {
  message: string;
  accept: string;
  decline: string;
} {
  const trimmed = targetLang.trim();
  const localized = PROMPT_COPY_BY_TARGET_LANGUAGE[trimmed.toLowerCase()];

  if (localized) {
    return localized;
  }

  const label = TARGET_LANGUAGE_LABELS[trimmed.toLowerCase()] ?? trimmed;
  return {
    message: `Translate these subtitles to ${label}?`,
    accept: "Yes",
    decline: "No"
  };
}

function createLoadingSpinner(): SVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute(
    "class",
    "hover-trans-port-youtube-subtitle-prompt-spinner"
  );
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");

  const track = document.createElementNS(namespace, "circle");
  track.setAttribute(
    "class",
    "hover-trans-port-youtube-subtitle-prompt-spinner-track"
  );
  track.setAttribute("cx", "12");
  track.setAttribute("cy", "12");
  track.setAttribute("r", "8");
  track.setAttribute("fill", "none");
  track.setAttribute("stroke", "currentColor");
  track.setAttribute("stroke-width", "3");

  const head = document.createElementNS(namespace, "path");
  head.setAttribute(
    "class",
    "hover-trans-port-youtube-subtitle-prompt-spinner-head"
  );
  head.setAttribute("d", "M20 12a8 8 0 0 0-8-8");
  head.setAttribute("fill", "none");
  head.setAttribute("stroke", "currentColor");
  head.setAttribute("stroke-width", "3");
  head.setAttribute("stroke-linecap", "round");

  const animation = document.createElementNS(namespace, "animateTransform");
  animation.setAttribute("attributeName", "transform");
  animation.setAttribute("type", "rotate");
  animation.setAttribute("from", "0 12 12");
  animation.setAttribute("to", "360 12 12");
  animation.setAttribute("dur", "0.8s");
  animation.setAttribute("repeatCount", "indefinite");
  head.appendChild(animation);
  svg.append(track, head);

  return svg;
}
