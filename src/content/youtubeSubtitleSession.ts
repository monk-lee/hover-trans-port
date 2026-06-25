import type {
  DebugLogFields,
  ExtensionRequest,
  ExtensionResponse,
  SubtitleTranslationChunkResultMessage,
  SubtitleTranslationProgressMessage,
  SubtitleTrackTranslationRequest,
  SubtitleTranslationCacheRequest,
  SubtitleTranslationCacheResponse,
  SubtitleTranslationResultResponse
} from "../shared/messages";
import type { ProviderId, ProviderSelection } from "../shared/providers";
import {
  createSubtitleSourceTimelineHash,
  createSubtitleTrackIdentity,
  planSubtitleChunks,
  SUBTITLE_TRANSLATION_PROMPT_VERSION,
  type TranslatedSubtitleCue,
  type YouTubeCaptionTrack,
  type YouTubeSubtitleCue
} from "../shared/youtubeSubtitles";
import {
  extractCaptionTracksFromPlayerResponse,
  selectCaptionTrackCandidates
} from "./youtubeCaptionTracks";
import {
  fetchYouTubeTranscript,
  fetchYouTubeTranscriptFromTranscriptPanel,
  fetchYouTubeTranscriptPanel
} from "./youtubeTranscriptFetch";
import { YouTubeSubtitleOverlay } from "./youtubeSubtitleOverlay";
import { YouTubeSubtitlePrompt } from "./youtubeSubtitlePrompt";

type FetchYouTubeTranscript = typeof fetchYouTubeTranscript;
type FetchYouTubeTranscriptPanel = typeof fetchYouTubeTranscriptPanel;
type FetchYouTubeTranscriptFromPanelDom =
  typeof fetchYouTubeTranscriptFromTranscriptPanel;

type StoredOptions = {
  hoverTransPort?: {
    provider?: string;
    codexModel?: string;
    modelsByProvider?: Partial<Record<ProviderId, string>>;
    targetLang?: string;
    timeoutMs?: number | string;
    youtubeSubtitleTimeoutMs?: number | string;
    cacheEnabled?: boolean;
    debugLogging?: boolean;
  };
};

type SessionDeps = {
  getPlayerResponse?: () => unknown;
  fetchTranscript?: FetchYouTubeTranscript;
  fetchTranscriptPanel?: FetchYouTubeTranscriptPanel;
  fetchTranscriptFromPanelDom?: FetchYouTubeTranscriptFromPanelDom;
};

const DEFAULT_PROVIDER: ProviderSelection = "codex";
const DEFAULT_TARGET_LANG = "Korean";
const DEFAULT_YOUTUBE_SUBTITLE_TIMEOUT_MS = 60000;
const MIN_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 120000;
const DEFAULT_CACHE_ENABLED = true;
const DEFAULT_DEBUG_LOGGING = false;
const PROVIDER_SELECTIONS = new Set<ProviderSelection>([
  "codex",
  "claude",
  "gemini",
  "opencode",
  "antigravity",
  "auto"
]);
const PROVIDER_DEFAULT_MODELS: Record<ProviderId, string> = {
  codex: "gpt-5.3-codex-spark",
  claude: "haiku",
  gemini: "",
  opencode: "",
  antigravity: ""
};
const LOCALE_TARGET_LANG_BY_PREFIX: Record<string, string> = {
  ko: "Korean",
  en: "English",
  ja: "Japanese",
  zh: "Chinese",
  es: "Spanish"
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

type PendingSubtitleSource = {
  videoId: string;
  trackCandidates: YouTubeCaptionTrack[];
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
  private readonly prompt = new YouTubeSubtitlePrompt({
    onAccept: () => void this.acceptTranslation(),
    onDecline: () => this.declineTranslation()
  });
  private readonly overlay = new YouTubeSubtitleOverlay();
  private current: CurrentSubtitleSource | null = null;
  private pending: PendingSubtitleSource | null = null;
  private translatedCues: TranslatedSubtitleCue[] | null = null;
  private video: HTMLVideoElement | null = null;
  private nativeSubtitleButton: HTMLButtonElement | null = null;
  private debugLogWriteQueue: Promise<void> = Promise.resolve();
  private refreshSequence = 0;
  private stopped = false;
  private translationInFlight = false;
  private activeTranslationRequestId: string | null = null;
  private resumePlaybackAfterFirstSubtitleChunk = false;
  private resumedPlaybackForActiveRequest = false;
  private subtitleTranslationErrorMessage: string | null = null;
  private lastOverlayDebugSignature: string | null = null;
  private readonly handleVideoTimeUpdate = () => {
    if (!this.stopped && this.video) {
      this.overlay.update(this.video.currentTime);
    }
  };
  private readonly handleNativeSubtitleButtonClick = () => {
    void Promise.resolve().then(() => this.syncNativeSubtitleButtonState());
  };
  private readonly handleRuntimeMessage = (message: ExtensionRequest) => {
    if (message.type === "SUBTITLE_TRANSLATION_PROGRESS") {
      this.handleTranslationProgress(message);
      return;
    }

    if (message.type === "SUBTITLE_TRANSLATION_CHUNK_RESULT") {
      this.handleTranslationChunkResult(message);
    }
  };

  constructor(private readonly deps: SessionDeps = {}) {
    chrome.runtime.onMessage.addListener(this.handleRuntimeMessage);
  }

  async refresh(): Promise<void> {
    if (this.stopped) {
      return;
    }

    const sequence = (this.refreshSequence += 1);
    const videoId = getCurrentYouTubeVideoId();
    const playerRoot =
      document.querySelector(".html5-video-player") ?? document.body;
    const video = document.querySelector("video");
    const nativeSubtitleButton = getNativeSubtitleButton();

    if (!videoId || !(video instanceof HTMLVideoElement)) {
      return;
    }

    this.prompt.mount(playerRoot);
    this.overlay.mount(playerRoot);
    this.bindVideo(video);
    this.bindNativeSubtitleButton(nativeSubtitleButton);

    if (this.translationInFlight) {
      return;
    }

    try {
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
      const timeoutMs = normalizeYouTubeSubtitleTimeoutMs(
        storedOptions?.youtubeSubtitleTimeoutMs
      );
      const debugLogging = normalizeDebugLogging(storedOptions?.debugLogging);

      const tracks = extractCaptionTracksFromPlayerResponse(
        this.deps.getPlayerResponse?.() ?? readYouTubePlayerResponse()
      );
      const trackCandidates = selectCaptionTrackCandidates({ tracks, targetLang });

      if (trackCandidates.length === 0) {
        this.current = null;
        this.pending = null;
        this.translatedCues = null;
        this.lastOverlayDebugSignature = null;
        this.overlay.clear();
        this.prompt.setState(
          this.isNativeSubtitleButtonOn()
            ? {
                status: "error",
                message: "사용 가능한 YouTube 자막이 없습니다."
              }
            : { status: "hidden" }
        );
        return;
      }

      const pendingSource: PendingSubtitleSource = {
        videoId,
        trackCandidates,
        targetLang,
        provider,
        model,
        timeoutMs,
        cacheEnabled,
        debugLogging
      };
      const previousPending = this.pending;
      this.pending = pendingSource;

      if (
        !this.current &&
        isSamePendingSubtitleSource(previousPending, pendingSource)
      ) {
        this.syncNativeSubtitleButtonState();
        return;
      }

      const loadedSource = await this.loadCurrentSubtitleSource(pendingSource, {
        allowTranscriptPanelDom: false,
        allowTranscriptPanelApi: false
      });

      if (sequence !== this.refreshSequence) {
        return;
      }

      if (!loadedSource) {
        this.current = null;
        this.syncNativeSubtitleButtonState();
        return;
      }

      const sourceChanged = !isSameSubtitleSource(this.current, loadedSource);
      this.current = loadedSource;
      this.pending = null;

      if (cacheEnabled) {
        const cacheResponse = await this.lookupCache(this.current);

        if (sequence !== this.refreshSequence) {
          return;
        }

        if (cacheResponse.ok && cacheResponse.cached) {
          this.subtitleTranslationErrorMessage = null;
          this.translatedCues = cacheResponse.cues;

          if (this.isNativeSubtitleButtonOn()) {
            this.activate(cacheResponse.cues);
          } else {
            this.overlay.clear();
            this.prompt.setState({ status: "hidden" });
          }
          return;
        }
      }

      if (sourceChanged) {
        this.subtitleTranslationErrorMessage = null;
        this.translatedCues = null;
        this.lastOverlayDebugSignature = null;
        this.overlay.clear();
      }

      this.syncNativeSubtitleButtonState();
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        this.stop();
        return;
      }

      if (sequence === this.refreshSequence) {
        this.current = null;
        this.prompt.setState(
          this.isNativeSubtitleButtonOn()
            ? {
                status: "error",
                message: "YouTube 자막을 불러오지 못했습니다."
              }
            : { status: "hidden" }
        );
      }
    }
  }

  async acceptTranslation(): Promise<void> {
    if (this.stopped || this.translationInFlight) {
      return;
    }

    this.translationInFlight = true;

    try {
      await this.runAcceptTranslation();
    } finally {
      this.translationInFlight = false;
    }
  }

  private async runAcceptTranslation(): Promise<void> {
    const video = this.video ?? document.querySelector("video");
    const wasPlaying = Boolean(video && !video.paused);
    video?.pause();
    this.subtitleTranslationErrorMessage = null;
    this.writeDebugEvent("youtube.subtitle.accept", {
      hasCurrent: this.current !== null,
      hasPending: this.pending !== null,
      videoId: this.current?.videoId ?? this.pending?.videoId ?? null
    });

    if (!this.current) {
      if (!this.pending) {
        this.writeDebugEvent("youtube.subtitle.accept_no_source");
        this.prompt.setState({
          status: "error",
          message: "YouTube 자막 스크립트를 읽지 못했습니다."
        });
        return;
      }

      this.prompt.setState({
        status: "loading",
        message: "자막 스크립트 읽는 중..."
      });

      try {
        this.current = await this.loadCurrentSubtitleSource(this.pending, {
          allowTranscriptPanelDom: true,
          allowTranscriptPanelApi: true,
          preferTranscriptPanelDom: true
        });
      } catch (error) {
        if (isExtensionContextInvalidated(error)) {
          this.stop();
          return;
        }

        this.writeDebugEvent("youtube.subtitle.panel_dom_error", {
          message: formatDebugError(error)
        });
        this.current = null;
      }

      if (!this.current) {
        this.writeDebugEvent("youtube.subtitle.panel_dom_empty", {
          videoId: this.pending.videoId,
          trackCandidateCount: this.pending.trackCandidates.length
        });
        this.prompt.setState({
          status: "error",
          message: "YouTube 자막 스크립트를 읽지 못했습니다."
        });
        return;
      }

      this.pending = null;
      this.writeDebugEvent("youtube.subtitle.source_loaded", {
        videoId: this.current.videoId,
        cueCount: this.current.cues.length,
        sourceTimelineHash: this.current.sourceTimelineHash,
        sourceTrackIdentity: this.current.sourceTrackIdentity,
        targetLang: this.current.targetLang,
        provider: this.current.provider,
        model: this.current.model,
        cacheEnabled: this.current.cacheEnabled
      });

      if (this.current.cacheEnabled) {
        this.writeDebugEvent("youtube.subtitle.cache_lookup_start", {
          videoId: this.current.videoId,
          sourceTimelineHash: this.current.sourceTimelineHash
        });
        let cacheResponse: SubtitleTranslationCacheResponse | null = null;

        try {
          cacheResponse = await this.lookupCache(this.current);
        } catch (error) {
          this.writeDebugEvent("youtube.subtitle.cache_lookup_result", {
            ok: false,
            cached: false,
            message: formatDebugError(error)
          });
        }

        if (cacheResponse) {
          this.writeDebugEvent("youtube.subtitle.cache_lookup_result", {
            ok: cacheResponse.ok,
            cached: cacheResponse.ok ? cacheResponse.cached : false,
            error: cacheResponse.ok ? null : cacheResponse.error,
            message: cacheResponse.ok ? null : cacheResponse.message
          });
        }

        if (cacheResponse?.ok && cacheResponse.cached) {
          this.activate(cacheResponse.cues);

          if (wasPlaying) {
            await video?.play().catch(() => undefined);
          }
          return;
        }
      }
    }

    const chunkCountEstimate = planSubtitleChunks(this.current.cues).length;
    this.prompt.setState({
      status: "loading",
      message: `번역 중... 0/${chunkCountEstimate}`
    });
    this.writeDebugEvent("youtube.subtitle.translation_start", {
      videoId: this.current.videoId,
      cueCount: this.current.cues.length,
      chunkCountEstimate,
      targetLang: this.current.targetLang,
      provider: this.current.provider,
      model: this.current.model,
      promptVersion: SUBTITLE_TRANSLATION_PROMPT_VERSION,
      timeoutMs: this.current.timeoutMs,
      cacheEnabled: this.current.cacheEnabled
    });

    const requestId = createRequestId();
    this.activeTranslationRequestId = requestId;
    this.resumePlaybackAfterFirstSubtitleChunk = wasPlaying;
    this.resumedPlaybackForActiveRequest = false;
    let response: SubtitleTranslationResultResponse;

    try {
      response = await chrome.runtime.sendMessage<
        SubtitleTrackTranslationRequest,
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
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        this.activeTranslationRequestId = null;
        this.stop();
        return;
      }

      this.activeTranslationRequestId = null;
      this.resumePlaybackAfterFirstSubtitleChunk = false;
      this.writeDebugEvent("youtube.subtitle.translation_error", {
        message: formatDebugError(error)
      });
      this.showSubtitleTranslationError("자막 번역에 실패했습니다.");
      return;
    }

    this.writeDebugEvent("youtube.subtitle.translation_result", {
      ok: response.ok,
      cached: response.ok ? response.cached : false,
      partial: response.ok ? response.partial ?? false : false,
      failedChunkCount: response.ok ? response.failedChunkCount ?? 0 : 0,
      provider: response.ok ? response.provider : response.provider ?? null,
      translatedCueCount: response.ok ? response.cues.length : 0,
      error: response.ok ? null : response.error,
      message: response.message ?? null,
      elapsedMs: response.ok ? response.elapsedMs : response.elapsedMs ?? null
    });
    this.activeTranslationRequestId = null;
    this.resumePlaybackAfterFirstSubtitleChunk = false;

    if (response.type === "SUBTITLE_TRANSLATION_RESULT" && response.ok) {
      this.subtitleTranslationErrorMessage = null;
      this.activate(response.cues);

      if (response.partial && response.message) {
        this.subtitleTranslationErrorMessage = response.message;
        this.prompt.setState({
          status: "error",
          message: response.message
        });
      }

      if (wasPlaying) {
        await video?.play().catch(() => undefined);
      }
      return;
    }

    if (this.translatedCues && this.translatedCues.length > 0) {
      this.subtitleTranslationErrorMessage =
        response.type === "SUBTITLE_TRANSLATION_RESULT" && !response.ok
          ? response.message
          : "일부 자막 번역에 실패했습니다.";
      this.prompt.setState({
        status: "error",
        message: this.subtitleTranslationErrorMessage
      });

      if (wasPlaying) {
        await video?.play().catch(() => undefined);
      }
      return;
    }

    this.showSubtitleTranslationError(
      response.type === "SUBTITLE_TRANSLATION_RESULT" && !response.ok
        ? response.message
        : "자막 번역에 실패했습니다."
    );
  }

  private async loadCurrentSubtitleSource(
    pendingSource: PendingSubtitleSource,
    options: {
      allowTranscriptPanelDom: boolean;
      allowTranscriptPanelApi: boolean;
      preferTranscriptPanelDom?: boolean;
    }
  ): Promise<CurrentSubtitleSource | null> {
    const loaded = await this.loadSubtitleCues(
      pendingSource.videoId,
      pendingSource.trackCandidates,
      options
    );

    if (!loaded) {
      return null;
    }

    return {
      videoId: pendingSource.videoId,
      cues: loaded.cues,
      sourceTimelineHash: createSubtitleSourceTimelineHash(loaded.cues),
      sourceTrackIdentity: createSubtitleTrackIdentity(loaded.track),
      targetLang: pendingSource.targetLang,
      provider: pendingSource.provider,
      model: pendingSource.model,
      timeoutMs: pendingSource.timeoutMs,
      cacheEnabled: pendingSource.cacheEnabled,
      debugLogging: pendingSource.debugLogging
    };
  }

  private async loadSubtitleCues(
    videoId: string,
    trackCandidates: YouTubeCaptionTrack[],
    options: {
      allowTranscriptPanelDom: boolean;
      allowTranscriptPanelApi: boolean;
      preferTranscriptPanelDom?: boolean;
    }
  ): Promise<{ track: YouTubeCaptionTrack; cues: YouTubeSubtitleCue[] } | null> {
    const panelTrack = createTranscriptPanelTrack(videoId, trackCandidates[0]);
    let triedPreferredTranscriptPanelDom = false;

    if (options.preferTranscriptPanelDom) {
      triedPreferredTranscriptPanelDom = true;
      const fetchFromPanelDom =
        this.deps.fetchTranscriptFromPanelDom ??
        fetchYouTubeTranscriptFromTranscriptPanel;
      const panelDomCues = await fetchFromPanelDom({
        onDebug: (event, fields = {}) => {
          this.writeDebugEvent(event, { ...fields, videoId });
        }
      });

      if (panelDomCues.length > 0) {
        return { track: panelTrack, cues: panelDomCues };
      }
    }

    let sawEmptyTranscript = false;
    let lastTranscriptError: unknown = null;
    const fetchTranscript = this.deps.fetchTranscript ?? fetchYouTubeTranscript;

    for (const [index, candidate] of trackCandidates.entries()) {
      try {
        const candidateCues = await fetchTranscript(candidate);
        this.writeDebugEvent("youtube.subtitle.timedtext_fetch_result", {
          videoId,
          trackIndex: index,
          trackCandidateCount: trackCandidates.length,
          trackIdentity: createSubtitleTrackIdentity(candidate),
          languageCode: candidate.languageCode,
          kind: candidate.kind,
          cueCount: candidateCues.length,
          error: null
        });

        if (candidateCues.length > 0) {
          return { track: candidate, cues: candidateCues };
        }

        sawEmptyTranscript = true;
      } catch (error) {
        lastTranscriptError = error;
        this.writeDebugEvent("youtube.subtitle.timedtext_fetch_result", {
          videoId,
          trackIndex: index,
          trackCandidateCount: trackCandidates.length,
          trackIdentity: createSubtitleTrackIdentity(candidate),
          languageCode: candidate.languageCode,
          kind: candidate.kind,
          cueCount: 0,
          error: formatDebugError(error)
        });
      }
    }

    let panelCues: YouTubeSubtitleCue[] = [];

    if (options.allowTranscriptPanelApi) {
      try {
        panelCues = await (
          this.deps.fetchTranscriptPanel ?? fetchYouTubeTranscriptPanel
        )();
        this.writeDebugEvent("youtube.subtitle.panel_api_result", {
          videoId,
          cueCount: panelCues.length,
          error: null
        });
      } catch (error) {
        this.writeDebugEvent("youtube.subtitle.panel_api_result", {
          videoId,
          cueCount: 0,
          error: formatDebugError(error)
        });
      }
    }

    if (panelCues.length > 0) {
      return { track: panelTrack, cues: panelCues };
    }

    if (options.allowTranscriptPanelDom && !triedPreferredTranscriptPanelDom) {
      const panelDomCues = await (
        this.deps.fetchTranscriptFromPanelDom ??
        fetchYouTubeTranscriptFromTranscriptPanel
      )({
        onDebug: (event, fields = {}) => {
          this.writeDebugEvent(event, { ...fields, videoId });
        }
      });

      if (panelDomCues.length > 0) {
        return { track: panelTrack, cues: panelDomCues };
      }
    }

    if (!sawEmptyTranscript && lastTranscriptError) {
      throw lastTranscriptError;
    }

    return null;
  }

  private writeDebugEvent(event: string, fields: DebugLogFields = {}): void {
    const debugLogging = this.current?.debugLogging ?? this.pending?.debugLogging;

    if (!debugLogging) {
      return;
    }

    const requestId = createRequestId();

    this.debugLogWriteQueue = this.debugLogWriteQueue
      .then(() =>
        chrome.runtime.sendMessage<ExtensionRequest, ExtensionResponse>({
          type: "WRITE_DEBUG_LOG_EVENT",
          requestId,
          event,
          fields
        })
      )
      .then(() => undefined)
      .catch(() => undefined);
  }

  private async lookupCache(
    current: CurrentSubtitleSource
  ): Promise<SubtitleTranslationCacheResponse> {
    const requestId = createRequestId();

    return chrome.runtime.sendMessage<
      SubtitleTranslationCacheRequest,
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

  private activate(
    cues: TranslatedSubtitleCue[],
    options: { hidePrompt?: boolean } = {}
  ): void {
    if (this.stopped) {
      return;
    }

    this.translatedCues = cues;
    this.overlay.setCues(cues);
    if (options.hidePrompt ?? true) {
      this.prompt.setState({ status: "hidden" });
    }
    this.handleVideoTimeUpdate();
    const activeCueId = this.video
      ? findActiveTranslatedCue(cues, this.video.currentTime)?.id ?? null
      : null;
    const debugState = this.overlay.getDebugState();
    const debugSignature = JSON.stringify({
      cueCount: cues.length,
      activeCueId,
      captionContainerActive: debugState.captionContainerActive,
      overlayNodeHidden: debugState.overlayNodeHidden,
      overlayTextLength: debugState.overlayTextLength
    });

    if (debugSignature === this.lastOverlayDebugSignature) {
      return;
    }

    this.lastOverlayDebugSignature = debugSignature;
    this.writeDebugEvent("youtube.subtitle.overlay_activated", {
      cueCount: cues.length,
      currentTimeMs: this.video
        ? Math.round(this.video.currentTime * 1000)
        : null,
      activeCueId,
      ...debugState
    });
  }

  private applyTranslatedCueChunk(cues: TranslatedSubtitleCue[]): void {
    if (this.stopped || cues.length === 0) {
      return;
    }

    this.translatedCues = mergeTranslatedSubtitleCues(
      this.translatedCues ?? [],
      cues
    );
    this.overlay.setCues(this.translatedCues);
    this.handleVideoTimeUpdate();
  }

  private showSubtitleTranslationError(message: string): void {
    this.subtitleTranslationErrorMessage = message;
    this.translatedCues = null;
    this.lastOverlayDebugSignature = null;
    this.overlay.clear();
    this.prompt.setState({
      status: "error",
      message
    });
  }

  private handleTranslationProgress(
    message: Pick<
      SubtitleTranslationProgressMessage,
      "requestId" | "currentChunk" | "totalChunks"
    >
  ): void {
    if (
      !this.translationInFlight ||
      message.requestId !== this.activeTranslationRequestId
    ) {
      return;
    }

    const currentChunk = Math.max(1, Math.round(message.currentChunk));
    const totalChunks = Math.max(currentChunk, Math.round(message.totalChunks));
    this.prompt.setState({
      status: "loading",
      message: `번역 중... ${currentChunk}/${totalChunks}`
    });
  }

  private handleTranslationChunkResult(
    message: SubtitleTranslationChunkResultMessage
  ): void {
    if (
      !this.translationInFlight ||
      message.requestId !== this.activeTranslationRequestId
    ) {
      return;
    }

    this.applyTranslatedCueChunk(message.cues);
    this.handleTranslationProgress(message);
    this.writeDebugEvent("youtube.subtitle.chunk_result", {
      currentChunk: message.currentChunk,
      totalChunks: message.totalChunks,
      cueCount: message.cues.length,
      provider: message.provider,
      cached: message.cached,
      elapsedMs: message.elapsedMs
    });

    if (
      this.resumePlaybackAfterFirstSubtitleChunk &&
      !this.resumedPlaybackForActiveRequest
    ) {
      this.resumedPlaybackForActiveRequest = true;
      void this.video?.play().catch(() => undefined);
    }
  }

  private declineTranslation(): void {
    if (this.current) {
      this.declinedVideoIds.add(this.current.videoId);
    } else if (this.pending) {
      this.declinedVideoIds.add(this.pending.videoId);
    }

    this.prompt.setState({ status: "hidden" });
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

  private bindNativeSubtitleButton(button: HTMLButtonElement | null): void {
    if (this.nativeSubtitleButton === button) {
      return;
    }

    this.nativeSubtitleButton?.removeEventListener(
      "click",
      this.handleNativeSubtitleButtonClick
    );
    this.nativeSubtitleButton = button;
    this.nativeSubtitleButton?.addEventListener(
      "click",
      this.handleNativeSubtitleButtonClick
    );
  }

  private syncNativeSubtitleButtonState(): void {
    if (this.stopped || this.translationInFlight) {
      return;
    }

    if (!this.isNativeSubtitleButtonOn()) {
      const hadTranslationError = Boolean(this.subtitleTranslationErrorMessage);
      this.subtitleTranslationErrorMessage = null;
      this.lastOverlayDebugSignature = null;
      this.overlay.clear();
      if (hadTranslationError) {
        this.translatedCues = null;
      }
      this.prompt.setState({ status: "hidden" });
      return;
    }

    if (this.subtitleTranslationErrorMessage) {
      if (this.translatedCues) {
        this.activate(this.translatedCues, { hidePrompt: false });
      }
      this.prompt.setState({
        status: "error",
        message: this.subtitleTranslationErrorMessage
      });
      return;
    }

    if (this.translatedCues) {
      this.activate(this.translatedCues);
      return;
    }

    const videoId = this.current?.videoId ?? this.pending?.videoId;
    const targetLang =
      this.current?.targetLang ?? this.pending?.targetLang ?? DEFAULT_TARGET_LANG;

    this.prompt.setState(
      videoId && !this.declinedVideoIds.has(videoId)
        ? { status: "prompt", targetLang }
        : { status: "hidden" }
    );
  }

  private isNativeSubtitleButtonOn(): boolean {
    return this.nativeSubtitleButton?.getAttribute("aria-pressed") === "true";
  }

  private stop(): void {
    this.stopped = true;
    this.current = null;
    this.pending = null;
    this.translatedCues = null;
    this.activeTranslationRequestId = null;
    this.resumePlaybackAfterFirstSubtitleChunk = false;
    this.resumedPlaybackForActiveRequest = false;
    this.overlay.clear();
    this.prompt.destroy();
    this.bindNativeSubtitleButton(null);
    chrome.runtime.onMessage.removeListener?.(this.handleRuntimeMessage);

    if (this.video) {
      this.video.removeEventListener("timeupdate", this.handleVideoTimeUpdate);
      this.video.removeEventListener("seeked", this.handleVideoTimeUpdate);
      this.video = null;
    }
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
      runSessionRefresh();
    }, 120);
  };

  runSessionRefresh();
  window.addEventListener("yt-navigate-finish", scheduleRefresh);

  if (document.body) {
    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

function runSessionRefresh(): void {
  void startedSession?.refresh().catch((error) => {
    if (isExtensionContextInvalidated(error)) {
      startedSession = null;
      return;
    }

    console.error("Hover Trans Port YouTube subtitle refresh failed.", error);
  });
}

function createRequestId(): string {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()}`;
}

function formatDebugError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeProvider(provider: string | undefined): ProviderSelection {
  return provider && PROVIDER_SELECTIONS.has(provider as ProviderSelection)
    ? (provider as ProviderSelection)
    : DEFAULT_PROVIDER;
}

function isSameSubtitleSource(
  left: CurrentSubtitleSource | null,
  right: CurrentSubtitleSource
): boolean {
  return Boolean(
    left &&
      left.videoId === right.videoId &&
      left.sourceTimelineHash === right.sourceTimelineHash &&
      left.sourceTrackIdentity === right.sourceTrackIdentity &&
      left.targetLang === right.targetLang &&
      left.provider === right.provider &&
      left.model === right.model
  );
}

function isSamePendingSubtitleSource(
  left: PendingSubtitleSource | null,
  right: PendingSubtitleSource
): boolean {
  return Boolean(
    left &&
      left.videoId === right.videoId &&
      left.targetLang === right.targetLang &&
      left.provider === right.provider &&
      left.model === right.model &&
      left.timeoutMs === right.timeoutMs &&
      left.cacheEnabled === right.cacheEnabled &&
      left.debugLogging === right.debugLogging &&
      createTrackCandidatesIdentity(left.trackCandidates) ===
        createTrackCandidatesIdentity(right.trackCandidates)
  );
}

function createTrackCandidatesIdentity(tracks: YouTubeCaptionTrack[]): string {
  return tracks.map((track) => createSubtitleTrackIdentity(track)).join("\n");
}

function createTranscriptPanelTrack(
  videoId: string,
  fallbackTrack: YouTubeCaptionTrack | undefined
): YouTubeCaptionTrack {
  return {
    id: `transcript-panel:${videoId}`,
    languageCode: fallbackTrack?.languageCode ?? "unknown",
    displayName: "YouTube transcript",
    kind: fallbackTrack?.kind ?? "manual",
    baseUrl: `youtubei:get_transcript:${videoId}`
  };
}

function resolveProviderForModel(provider: ProviderSelection): ProviderId {
  return provider === "auto" ? "codex" : provider;
}

function normalizeProviderModel(
  provider: ProviderId,
  model: string | undefined
): string {
  const trimmed = model?.trim();

  return trimmed || PROVIDER_DEFAULT_MODELS[provider];
}

function getModelForProvider(
  options: StoredOptions["hoverTransPort"],
  provider: ProviderSelection
): string {
  const providerId = resolveProviderForModel(provider);
  const configured =
    options?.modelsByProvider?.[providerId] ??
    (providerId === "codex" ? options?.codexModel : undefined);

  return normalizeProviderModel(providerId, configured);
}

function normalizeTargetLang(targetLang: string | undefined, fallback: string): string {
  const trimmed = targetLang?.trim();

  if (trimmed) {
    return trimmed;
  }

  return fallback.trim() || DEFAULT_TARGET_LANG;
}

function getBrowserTargetLang(locales: Array<string | undefined>): string {
  for (const locale of locales) {
    const prefix = locale?.trim().toLowerCase().split(/[-_]/u)[0];

    if (prefix && LOCALE_TARGET_LANG_BY_PREFIX[prefix]) {
      return LOCALE_TARGET_LANG_BY_PREFIX[prefix];
    }
  }

  return DEFAULT_TARGET_LANG;
}

function findActiveTranslatedCue(
  cues: TranslatedSubtitleCue[],
  currentTimeSeconds: number
): TranslatedSubtitleCue | null {
  const currentMs = Math.round(currentTimeSeconds * 1000);

  return (
    cues.find((cue) => currentMs >= cue.startMs && currentMs < cue.endMs) ?? null
  );
}

function mergeTranslatedSubtitleCues(
  existing: TranslatedSubtitleCue[],
  incoming: TranslatedSubtitleCue[]
): TranslatedSubtitleCue[] {
  const cuesById = new Map<string, TranslatedSubtitleCue>();

  for (const cue of existing) {
    cuesById.set(cue.id, cue);
  }

  for (const cue of incoming) {
    cuesById.set(cue.id, cue);
  }

  return [...cuesById.values()].sort((left, right) => {
    if (left.startMs !== right.startMs) {
      return left.startMs - right.startMs;
    }

    return left.endMs - right.endMs;
  });
}

function normalizeYouTubeSubtitleTimeoutMs(
  timeoutMs: number | string | undefined
): number {
  return normalizeTimeoutMsWithFallback(
    timeoutMs,
    DEFAULT_YOUTUBE_SUBTITLE_TIMEOUT_MS
  );
}

function normalizeTimeoutMsWithFallback(
  timeoutMs: number | string | undefined,
  fallbackMs: number
): number {
  const rawTimeoutMs =
    typeof timeoutMs === "number" ? timeoutMs : timeoutMs?.trim();

  if (rawTimeoutMs === undefined || rawTimeoutMs === "") {
    return fallbackMs;
  }

  const parsed =
    typeof rawTimeoutMs === "number" ? rawTimeoutMs : Number(rawTimeoutMs);

  if (!Number.isFinite(parsed)) {
    return fallbackMs;
  }

  return Math.min(
    MAX_TIMEOUT_MS,
    Math.max(MIN_TIMEOUT_MS, Math.round(parsed))
  );
}

function normalizeCacheEnabled(cacheEnabled: boolean | undefined): boolean {
  return typeof cacheEnabled === "boolean"
    ? cacheEnabled
    : DEFAULT_CACHE_ENABLED;
}

function normalizeDebugLogging(debugLogging: boolean | undefined): boolean {
  return typeof debugLogging === "boolean"
    ? debugLogging
    : DEFAULT_DEBUG_LOGGING;
}

function getCurrentYouTubeVideoId(): string | null {
  return new URL(location.href).searchParams.get("v");
}

function getNativeSubtitleButton(): HTMLButtonElement | null {
  const button = document.querySelector(".ytp-subtitles-button");

  return button instanceof HTMLButtonElement ? button : null;
}

function isYouTubeHost(): boolean {
  return location.hostname === "www.youtube.com" || location.hostname === "youtube.com";
}

function readYouTubePlayerResponse(): unknown {
  const playerResponse = readYouTubePlayerResponseFromPlayer();

  if (playerResponse) {
    return playerResponse;
  }

  const windowPlayerResponse = (
    window as typeof window & { ytInitialPlayerResponse?: unknown }
  ).ytInitialPlayerResponse;

  if (windowPlayerResponse) {
    return windowPlayerResponse;
  }

  return readYouTubePlayerResponseFromScripts();
}

function readYouTubePlayerResponseFromPlayer(): unknown {
  const candidates = [
    document.getElementById("movie_player"),
    document.querySelector(".html5-video-player")
  ];

  for (const candidate of candidates) {
    const getPlayerResponse = (
      candidate as (Element & { getPlayerResponse?: () => unknown }) | null
    )?.getPlayerResponse;

    if (typeof getPlayerResponse !== "function") {
      continue;
    }

    try {
      const playerResponse = getPlayerResponse.call(candidate);

      if (playerResponse && typeof playerResponse === "object") {
        return playerResponse;
      }
    } catch {
      // Fall back to other player response sources below.
    }
  }

  return null;
}

function readYouTubePlayerResponseFromScripts(): unknown {
  for (const script of Array.from(document.querySelectorAll("script"))) {
    const text = script.textContent ?? "";
    const markerIndex = text.indexOf("ytInitialPlayerResponse");

    if (markerIndex < 0) {
      continue;
    }

    const assignmentIndex = text.indexOf("=", markerIndex);
    const objectStart =
      assignmentIndex >= 0 ? text.indexOf("{", assignmentIndex) : -1;

    if (objectStart < 0) {
      continue;
    }

    const jsonText = extractJsonObjectAt(text, objectStart);

    if (!jsonText) {
      continue;
    }

    try {
      const parsed = JSON.parse(jsonText);

      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // Keep scanning other scripts: YouTube may include non-JSON assignments.
    }
  }

  return null;
}

function extractJsonObjectAt(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function isExtensionContextInvalidated(error: unknown): boolean {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error);

  return message.toLowerCase().includes("extension context invalidated");
}
