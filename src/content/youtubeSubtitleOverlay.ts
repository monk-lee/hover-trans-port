import type { TranslatedSubtitleCue } from "../shared/youtubeSubtitles";

const OVERLAY_ATTRIBUTE = "data-hover-trans-port-youtube-subtitle-overlay";
const STYLE_ID = "hover-trans-port-youtube-subtitle-overlay-style";

function ensureOverlayStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .hover-trans-port-youtube-subtitle-overlay {
      bottom: 72px;
      box-sizing: border-box;
      color: #fff;
      font: 600 22px/1.35 Arial, sans-serif;
      left: 50%;
      max-width: min(86%, 960px);
      padding: 4px 10px;
      pointer-events: none;
      position: absolute;
      text-align: center;
      text-shadow:
        0 2px 3px rgba(0, 0, 0, 0.9),
        0 0 5px rgba(0, 0, 0, 0.75);
      transform: translateX(-50%);
      white-space: pre-line;
      z-index: 2147483646;
    }
    .hover-trans-port-youtube-subtitle-overlay[hidden] {
      display: none;
    }
  `;
  (document.head ?? document.documentElement).appendChild(style);
}

export class YouTubeSubtitleOverlay {
  private node: HTMLElement | null = null;
  private cues: TranslatedSubtitleCue[] = [];

  mount(playerRoot: Element): void {
    ensureOverlayStyle();
    const existing = playerRoot.querySelector<HTMLElement>(
      `[${OVERLAY_ATTRIBUTE}="true"]`
    );
    this.node = existing ?? document.createElement("div");
    this.node.setAttribute(OVERLAY_ATTRIBUTE, "true");
    this.node.className = "hover-trans-port-youtube-subtitle-overlay notranslate";

    if (!existing) {
      playerRoot.appendChild(this.node);
    }

    this.clear();
  }

  setCues(cues: TranslatedSubtitleCue[]): void {
    this.cues = [...cues].sort((left, right) => left.startMs - right.startMs);
  }

  update(currentTimeSeconds: number): void {
    if (!this.node) {
      return;
    }

    const currentMs = Math.round(currentTimeSeconds * 1000);
    const cue = this.cues.find((candidate) => {
      return currentMs >= candidate.startMs && currentMs < candidate.endMs;
    });
    this.node.textContent = cue?.translatedText ?? "";
    this.node.hidden = !cue;
  }

  clear(): void {
    this.cues = [];

    if (this.node) {
      this.node.textContent = "";
      this.node.hidden = true;
    }
  }
}
