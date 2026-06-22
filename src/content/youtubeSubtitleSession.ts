import {
  getBrowserTargetLang,
  getModelForProvider,
  normalizeCacheEnabled,
  normalizeDebugLogging,
  normalizeProvider,
  normalizeTargetLang,
  normalizeTimeoutMs,
  type StoredOptions
} from "../shared/options";
import type { ProviderId, ProviderSelection } from "../shared/providers";
import {
  createSubtitleSourceTimelineHash,
  createSubtitleTrackIdentity,
  SUBTITLE_TRANSLATION_PROMPT_VERSION,
  type TranslatedSubtitleCue,
  type YouTubeSubtitleCue
} from "../shared/youtubeSubtitles";
import {
  extractCaptionTracksFromPlayerResponse,
  selectCaptionTrack
} from "./youtubeCaptionTracks";
import {
  fetchYouTubeTranscript
} from "./youtubeTranscriptFetch";
import { YouTubeSubtitleControl } from "./youtubeSubtitleControl";
import { YouTubeSubtitleOverlay } from "./youtubeSubtitleOverlay";

type FetchYouTubeTranscript = typeof fetchYouTubeTranscript;

type SessionDeps = {
  getPlayerResponse?: () => unknown;
  fetchTranscript?: FetchYouTubeTranscript;
};

type SubtitleCacheLookupRequest = {
  type: "GET_SUBTITLE_TRANSLATION_CACHE";
  requestId: string;
  videoId: string;
  sourceTrackIdentity: string;
  sourceTimelineHash: string;
  targetLang: string;
  provider: ProviderSelection;
  model: string;
  promptVersion: number;
};

type SubtitleTranslationRequest = Omit<
  SubtitleCacheLookupRequest,
  "type"
> & {
  type: "TRANSLATE_SUBTITLE_TRACK";
  cues: YouTubeSubtitleCue[];
  timeoutMs?: number;
  cacheEnabled?: boolean;
  debugLogging?: boolean;
};

type SubtitleTranslationCacheResponse =
  | {
      type: "SUBTITLE_TRANSLATION_CACHE_RESULT";
      requestId: string;
      ok: true;
      cached: true;
      cues: TranslatedSubtitleCue[];
    }
  | {
      type: "SUBTITLE_TRANSLATION_CACHE_RESULT";
      requestId: string;
      ok: true;
      cached: false;
    }
  | {
      type: "SUBTITLE_TRANSLATION_CACHE_RESULT";
      requestId: string;
      ok: false;
      message: string;
      retryable: boolean;
    };

type SubtitleTranslationResultResponse =
  | {
      type: "SUBTITLE_TRANSLATION_RESULT";
      requestId: string;
      ok: true;
      provider: ProviderId;
      cues: TranslatedSubtitleCue[];
      cached: boolean;
      elapsedMs: number;
    }
  | {
      type: "SUBTITLE_TRANSLATION_RESULT";
      requestId: string;
      ok: false;
      provider?: ProviderId;
      message: string;
      retryable: boolean;
      elapsedMs?: number;
    };

type CurrentSubtitleSource = {
  videoId: string;
  cues: YouTubeSubtitleCue[];
  sourceTimelineHash: string;
  sourceTrackIdentity: string;
  targetLang: string;
  provider: ProviderSelection;
  model: string;
  timeoutMs: number;
  cacheEnabled: boolean;
  debugLogging: boolean;
};

let startedSession: YouTubeSubtitleSession | null = null;
let refreshTimer: number | null = null;

export class YouTubeSubtitleSession {
  private readonly declinedVideoIds = new Set<string>();
  private readonly control = new YouTubeSubtitleControl({
    onAccept: () => void this.acceptTranslation(),
    onDecline: () => this.declineTranslation(),
    onToggle: () => this.toggleOverlay()
  });
  private readonly overlay = new YouTubeSubtitleOverlay();
  private current: CurrentSubtitleSource | null = null;
  private video: HTMLVideoElement | null = null;
  private refreshSequence = 0;
  private readonly handleVideoTimeUpdate = () => {
    if (this.video) {
      this.overlay.update(this.video.currentTime);
    }
  };

  constructor(private readonly deps: SessionDeps = {}) {}

  async refresh(): Promise<void> {
    const sequence = (this.refreshSequence += 1);
    const videoId = getCurrentYouTubeVideoId();
    const controls = document.querySelector(".ytp-right-controls-left");
    const playerRoot =
      document.querySelector(".html5-video-player") ?? document.body;
    const video = document.querySelector("video");

    if (!videoId || !controls || !(video instanceof HTMLVideoElement)) {
      return;
    }

    this.control.mount(controls);
    this.overlay.mount(playerRoot);
    this.bindVideo(video);

    const options = (await chrome.storage.local.get(
      "hoverTransPort"
    )) as StoredOptions;
    const storedOptions = options.hoverTransPort;
    const provider = normalizeProvider(storedOptions?.provider);
    const targetLang = normalizeTargetLang(
      storedOptions?.targetLang,
      getBrowserTargetLang([navigator.language])
    );
    const model = getModelForProvider(storedOptions, provider);
    const cacheEnabled = normalizeCacheEnabled(storedOptions?.cacheEnabled);
    const timeoutMs = normalizeTimeoutMs(storedOptions?.timeoutMs);
    const debugLogging = normalizeDebugLogging(storedOptions?.debugLogging);

    const tracks = extractCaptionTracksFromPlayerResponse(
      this.deps.getPlayerResponse?.() ?? readYouTubePlayerResponse()
    );
    const track = selectCaptionTrack({ tracks, targetLang });

    if (!track) {
      this.current = null;
      this.control.setState({
        status: "unavailable",
        message: "사용 가능한 YouTube 자막이 없습니다."
      });
      return;
    }

    try {
      const cues = await (this.deps.fetchTranscript ?? fetchYouTubeTranscript)(
        track
      );

      if (sequence !== this.refreshSequence) {
        return;
      }

      if (cues.length === 0) {
        this.current = null;
        this.control.setState({
          status: "unavailable",
          message: "번역할 YouTube 자막 내용이 없습니다."
        });
        return;
      }

      const sourceTimelineHash = createSubtitleSourceTimelineHash(cues);
      const sourceTrackIdentity = createSubtitleTrackIdentity(track);
      this.current = {
        videoId,
        cues,
        sourceTimelineHash,
        sourceTrackIdentity,
        targetLang,
        provider,
        model,
        timeoutMs,
        cacheEnabled,
        debugLogging
      };

      if (cacheEnabled) {
        const cacheResponse = await this.lookupCache(this.current);

        if (sequence !== this.refreshSequence) {
          return;
        }

        if (cacheResponse.ok && cacheResponse.cached) {
          this.activate(cacheResponse.cues);
          return;
        }
      }

      this.control.setState(
        this.declinedVideoIds.has(videoId)
          ? { status: "disabled" }
          : { status: "prompt" }
      );
    } catch {
      if (sequence === this.refreshSequence) {
        this.current = null;
        this.control.setState({
          status: "error",
          message: "YouTube 자막을 불러오지 못했습니다."
        });
      }
    }
  }

  async acceptTranslation(): Promise<void> {
    if (!this.current) {
      return;
    }

    const video = this.video ?? document.querySelector("video");
    const wasPlaying = Boolean(video && !video.paused);
    video?.pause();
    this.control.setState({ status: "loading", message: "번역 중..." });

    const requestId = createRequestId();
    const response = await chrome.runtime.sendMessage<
      SubtitleTranslationRequest,
      SubtitleTranslationResultResponse
    >({
      type: "TRANSLATE_SUBTITLE_TRACK",
      requestId,
      videoId: this.current.videoId,
      sourceTrackIdentity: this.current.sourceTrackIdentity,
      sourceTimelineHash: this.current.sourceTimelineHash,
      targetLang: this.current.targetLang,
      provider: this.current.provider,
      model: this.current.model,
      promptVersion: SUBTITLE_TRANSLATION_PROMPT_VERSION,
      cues: this.current.cues,
      timeoutMs: this.current.timeoutMs,
      cacheEnabled: this.current.cacheEnabled,
      debugLogging: this.current.debugLogging
    });

    if (response.type === "SUBTITLE_TRANSLATION_RESULT" && response.ok) {
      this.activate(response.cues);

      if (wasPlaying) {
        await video?.play().catch(() => undefined);
      }
      return;
    }

    this.control.setState({
      status: "error",
      message: "자막 번역에 실패했습니다."
    });
  }

  private async lookupCache(
    current: CurrentSubtitleSource
  ): Promise<SubtitleTranslationCacheResponse> {
    const requestId = createRequestId();

    return chrome.runtime.sendMessage<
      SubtitleCacheLookupRequest,
      SubtitleTranslationCacheResponse
    >({
      type: "GET_SUBTITLE_TRANSLATION_CACHE",
      requestId,
      videoId: current.videoId,
      sourceTrackIdentity: current.sourceTrackIdentity,
      sourceTimelineHash: current.sourceTimelineHash,
      targetLang: current.targetLang,
      provider: current.provider,
      model: current.model,
      promptVersion: SUBTITLE_TRANSLATION_PROMPT_VERSION
    });
  }

  private activate(cues: TranslatedSubtitleCue[]): void {
    this.overlay.setCues(cues);
    this.control.setState({ status: "enabled" });
    this.handleVideoTimeUpdate();
  }

  private declineTranslation(): void {
    if (this.current) {
      this.declinedVideoIds.add(this.current.videoId);
    }

    this.control.setState({ status: "disabled" });
  }

  private toggleOverlay(): void {
    this.overlay.clear();
    this.control.setState({ status: "disabled" });
  }

  private bindVideo(video: HTMLVideoElement): void {
    if (this.video === video) {
      return;
    }

    if (this.video) {
      this.video.removeEventListener("timeupdate", this.handleVideoTimeUpdate);
      this.video.removeEventListener("seeked", this.handleVideoTimeUpdate);
    }

    this.video = video;
    this.video.addEventListener("timeupdate", this.handleVideoTimeUpdate);
    this.video.addEventListener("seeked", this.handleVideoTimeUpdate);
  }
}

export function startYouTubeSubtitleSession(): void {
  if (startedSession || !isYouTubeHost()) {
    return;
  }

  startedSession = new YouTubeSubtitleSession();
  const scheduleRefresh = () => {
    if (!startedSession) {
      return;
    }

    if (refreshTimer !== null) {
      window.clearTimeout(refreshTimer);
    }

    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      void startedSession?.refresh();
    }, 120);
  };

  void startedSession.refresh();
  window.addEventListener("yt-navigate-finish", scheduleRefresh);

  if (document.body) {
    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

function createRequestId(): string {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()}`;
}

function getCurrentYouTubeVideoId(): string | null {
  return new URL(location.href).searchParams.get("v");
}

function isYouTubeHost(): boolean {
  return location.hostname === "www.youtube.com" || location.hostname === "youtube.com";
}

function readYouTubePlayerResponse(): unknown {
  return (window as typeof window & { ytInitialPlayerResponse?: unknown })
    .ytInitialPlayerResponse ?? null;
}
