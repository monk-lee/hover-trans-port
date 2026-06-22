import type { TranslatedSubtitleCue } from "../shared/youtubeSubtitles";

const OVERLAY_ATTRIBUTE = "data-hover-trans-port-youtube-subtitle-overlay";
const CAPTION_CONTAINER_ATTRIBUTE =
  "data-hover-trans-port-youtube-caption-container";
const FALLBACK_CAPTION_CONTAINER_ATTRIBUTE =
  "data-hover-trans-port-youtube-fallback-caption-container";
const ACTIVE_ATTRIBUTE = "data-hover-trans-port-youtube-subtitles-active";
const SEGMENT_ATTRIBUTE = "data-hover-trans-port-youtube-subtitle-segment";
const STYLE_ID = "hover-trans-port-youtube-subtitle-overlay-style";

function ensureOverlayStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    [${FALLBACK_CAPTION_CONTAINER_ATTRIBUTE}="true"] {
      inset: 0;
      pointer-events: none;
      position: absolute;
      z-index: 60;
    }
    [${ACTIVE_ATTRIBUTE}="true"] > .caption-window:not([${OVERLAY_ATTRIBUTE}="true"]) {
      visibility: hidden !important;
    }
    .caption-window.hover-trans-port-youtube-subtitle-overlay {
      background-color: rgba(8, 8, 8, 0.25);
      bottom: 2%;
      box-sizing: border-box;
      left: 50%;
      margin-left: 0;
      max-width: min(86vw, 960px);
      pointer-events: none;
      position: absolute;
      text-align: center;
      transform: translateX(-50%);
      width: max-content;
      z-index: 1;
    }
    .hover-trans-port-youtube-subtitle-overlay[hidden] {
      display: none;
    }
    .hover-trans-port-youtube-subtitle-overlay .captions-text,
    .hover-trans-port-youtube-subtitle-overlay .caption-visual-line {
      display: block;
    }
    .hover-trans-port-youtube-subtitle-overlay .ytp-caption-segment {
      background: rgba(8, 8, 8, 0.75);
      color: rgb(255, 255, 255);
      display: inline-block;
      fill: rgb(255, 255, 255);
      font-family: "YouTube Noto", Roboto, Arial, Helvetica, Verdana, "PT Sans Caption", sans-serif;
      font-size: clamp(18px, 2.35vw, 26px);
      line-height: 1.35;
      overflow-wrap: anywhere;
      padding: 0 0.15em;
      white-space: pre-wrap;
    }
  `;
  (document.head ?? document.documentElement).appendChild(style);
}

export class YouTubeSubtitleOverlay {
  private node: HTMLElement | null = null;
  private captionContainer: HTMLElement | null = null;
  private segment: HTMLElement | null = null;
  private cues: TranslatedSubtitleCue[] = [];

  mount(playerRoot: Element): void {
    ensureOverlayStyle();
    const captionContainer = findOrCreateCaptionContainer(playerRoot);
    const existing = captionContainer.querySelector<HTMLElement>(
      `[${OVERLAY_ATTRIBUTE}="true"]`
    );
    this.captionContainer = captionContainer;
    this.node = existing ?? createCaptionWindow();
    this.node.setAttribute(OVERLAY_ATTRIBUTE, "true");
    this.node.className =
      "caption-window ytp-caption-window-bottom hover-trans-port-youtube-subtitle-overlay notranslate";
    this.node.setAttribute("dir", "ltr");
    this.segment = this.node.querySelector<HTMLElement>(
      `[${SEGMENT_ATTRIBUTE}="true"]`
    );

    if (!this.segment) {
      const contents = createCaptionContents();
      this.node.replaceChildren(contents.root);
      this.segment = contents.segment;
    }

    if (!existing) {
      captionContainer.appendChild(this.node);
      this.node.hidden = true;
      this.node.setAttribute("aria-hidden", "true");
    }
  }

  setCues(cues: TranslatedSubtitleCue[]): void {
    this.cues = [...cues].sort((left, right) => left.startMs - right.startMs);

    if (this.cues.length > 0) {
      this.captionContainer?.setAttribute(ACTIVE_ATTRIBUTE, "true");
    } else {
      this.captionContainer?.removeAttribute(ACTIVE_ATTRIBUTE);
    }
  }

  update(currentTimeSeconds: number): void {
    if (!this.node || !this.segment) {
      return;
    }

    this.ensureAttached();
    const currentMs = Math.round(currentTimeSeconds * 1000);
    const cue = this.cues.find((candidate) => {
      return currentMs >= candidate.startMs && currentMs < candidate.endMs;
    });
    this.segment.textContent = cue?.translatedText ?? "";
    this.node.hidden = !cue;
    this.node.setAttribute("aria-hidden", cue ? "false" : "true");
  }

  clear(): void {
    this.cues = [];
    this.captionContainer?.removeAttribute(ACTIVE_ATTRIBUTE);

    if (this.node && this.segment) {
      this.segment.textContent = "";
      this.node.hidden = true;
      this.node.setAttribute("aria-hidden", "true");
    }
  }

  private ensureAttached(): void {
    if (
      this.node &&
      this.captionContainer &&
      this.node.parentElement !== this.captionContainer
    ) {
      this.captionContainer.appendChild(this.node);
    }
  }
}

function findOrCreateCaptionContainer(playerRoot: Element): HTMLElement {
  const existing =
    playerRoot.querySelector<HTMLElement>(
      "#ytp-caption-window-container, .ytp-caption-window-container"
    ) ??
    document.querySelector<HTMLElement>(
      "#ytp-caption-window-container, .ytp-caption-window-container"
    );

  if (existing) {
    existing.setAttribute(CAPTION_CONTAINER_ATTRIBUTE, "true");
    return existing;
  }

  const captionContainer = document.createElement("div");
  captionContainer.className = "ytp-caption-window-container";
  captionContainer.setAttribute(CAPTION_CONTAINER_ATTRIBUTE, "true");
  captionContainer.setAttribute(FALLBACK_CAPTION_CONTAINER_ATTRIBUTE, "true");
  playerRoot.appendChild(captionContainer);

  return captionContainer;
}

function createCaptionWindow(): HTMLElement {
  const windowNode = document.createElement("div");
  const contents = createCaptionContents();
  windowNode.appendChild(contents.root);

  return windowNode;
}

function createCaptionContents(): { root: HTMLElement; segment: HTMLElement } {
  const captionsText = document.createElement("span");
  captionsText.className = "captions-text";

  const visualLine = document.createElement("span");
  visualLine.className = "caption-visual-line";

  const segment = document.createElement("span");
  segment.className = "ytp-caption-segment";
  segment.setAttribute(SEGMENT_ATTRIBUTE, "true");

  visualLine.appendChild(segment);
  captionsText.appendChild(visualLine);

  return { root: captionsText, segment };
}
