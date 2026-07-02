import type {
  ProviderId,
  ProviderModelCatalog,
  ProviderSelection
} from "./providers";
import type {
  TranslatedSubtitleCue,
  YouTubeSubtitleCue
} from "./youtubeSubtitles";

export type TranslationTargetMode = "selection" | "hover-block";

export type AnchorRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type SourceElement = {
  ownerKey: string;
  tagName: string;
  renderStrategy: "inside-source";
};

export type InlineAnnotationKind =
  | "a"
  | "code"
  | "strong"
  | "b"
  | "em"
  | "i"
  | "kbd"
  | "mark"
  | "sup"
  | "sub";

export type InlineAnnotation = {
  id: string;
  kind: InlineAnnotationKind;
  text: string;
  href?: string;
  target?: string;
  rel?: string;
  className?: string;
  styleText?: string;
};

export type LinkAnnotation = InlineAnnotation;

export type DebugLogPrimitive = string | number | boolean | null;

export type DebugLogFields = Record<string, DebugLogPrimitive | undefined>;

export type TranslationTarget = {
  mode: TranslationTargetMode;
  text: string;
  inlineAnnotations?: InlineAnnotation[];
  anchorRect: AnchorRect;
  pageUrl: string;
  pageTitle: string;
  sourceElement: SourceElement;
};

export type SubtitleTranslationCacheRequest = {
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

export type SubtitleTrackTranslationRequest = Omit<
  SubtitleTranslationCacheRequest,
  "type"
> & {
  type: "TRANSLATE_SUBTITLE_TRACK";
  cues: YouTubeSubtitleCue[];
  currentTimeMs?: number;
  timeoutMs?: number;
  cacheEnabled?: boolean;
  debugLogging?: boolean;
};

export type SubtitleTranslationProgressMessage = {
  type: "SUBTITLE_TRANSLATION_PROGRESS";
  requestId: string;
  currentChunk: number;
  totalChunks: number;
};

export type SubtitleTranslationChunkResultMessage = {
  type: "SUBTITLE_TRANSLATION_CHUNK_RESULT";
  requestId: string;
  currentChunk: number;
  totalChunks: number;
  provider: ProviderId;
  cues: TranslatedSubtitleCue[];
  cached: boolean;
  elapsedMs: number;
};

export type ExtensionRequest =
  | {
      type: "PING";
    }
  | {
      type: "CHECK_NATIVE_HOST";
      requestId: string;
    }
  | {
      type: "GET_STORED_NATIVE_HOST_UPDATE_STATUS";
      requestId: string;
    }
  | {
      type: "CHECK_NATIVE_HOST_UPDATE";
      requestId: string;
    }
  | {
      type: "UPDATE_NATIVE_HOST";
      requestId: string;
      targetTag: string;
      targetVersion: string;
    }
  | {
      type: "CHECK_PROVIDER_STATUS";
      requestId: string;
      provider: ProviderSelection;
    }
  | {
      type: "GET_PROVIDER_MODELS";
      requestId: string;
      provider: ProviderSelection;
    }
  | {
      type: "CLEAR_TRANSLATION_CACHE";
      requestId: string;
    }
  | {
      type: "GET_DEBUG_LOG_INFO";
      requestId: string;
    }
  | {
      type: "CLEAR_DEBUG_LOG";
      requestId: string;
    }
  | {
      type: "GET_DEBUG_LOG_CONTENT";
      requestId: string;
      maxBytes?: number;
      maxLines?: number;
    }
  | {
      type: "WRITE_DEBUG_LOG_EVENT";
      requestId: string;
      event: string;
      fields?: DebugLogFields;
    }
  | SubtitleTranslationCacheRequest
  | SubtitleTrackTranslationRequest
  | SubtitleTranslationProgressMessage
  | SubtitleTranslationChunkResultMessage
  | {
      type: "TRANSLATE_CURRENT_TARGET";
      requestId: string;
      target: TranslationTarget;
    };

export type TranslationResultResponse =
  | {
      type: "TRANSLATE_RESULT";
      requestId: string;
      ok: true;
      provider: ProviderId;
      translatedText: string;
      cached: boolean;
      elapsedMs: number;
    }
  | {
      type: "TRANSLATE_RESULT";
      requestId: string;
      ok: false;
      provider?: ProviderId;
      error:
        | "NO_TRANSLATION_TARGET"
        | "NATIVE_HOST_UNAVAILABLE"
        | "NATIVE_HOST_UPDATE_REQUIRED"
        | "NATIVE_HOST_UNSUPPORTED"
        | "PROVIDER_NOT_FOUND"
        | "PROVIDER_UNAVAILABLE"
        | "PROVIDER_TIMEOUT"
        | "PROVIDER_EXIT_NONZERO"
        | "PROVIDER_OUTPUT_PARSE_FAILED"
        | "CACHE_ERROR"
        | "UNKNOWN_ERROR";
      message: string;
      retryable: boolean;
      elapsedMs?: number;
    };

export type SubtitleTranslationCacheResponse =
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
      error:
        | "NATIVE_HOST_UNAVAILABLE"
        | "NATIVE_HOST_UPDATE_REQUIRED"
        | "NATIVE_HOST_UNSUPPORTED"
        | "CACHE_ERROR"
        | "UNKNOWN_ERROR";
      message: string;
      retryable: boolean;
    };

export type SubtitleTranslationResultResponse =
  | {
      type: "SUBTITLE_TRANSLATION_RESULT";
      requestId: string;
      ok: true;
      provider: ProviderId;
      cues: TranslatedSubtitleCue[];
      cached: boolean;
      elapsedMs: number;
      partial?: boolean;
      failedChunkCount?: number;
      message?: string;
    }
  | {
      type: "SUBTITLE_TRANSLATION_RESULT";
      requestId: string;
      ok: false;
      provider?: ProviderId;
      error:
        | "NATIVE_HOST_UNAVAILABLE"
        | "NATIVE_HOST_UPDATE_REQUIRED"
        | "NATIVE_HOST_UNSUPPORTED"
        | "PROVIDER_NOT_FOUND"
        | "PROVIDER_TIMEOUT"
        | "PROVIDER_EXIT_NONZERO"
        | "PROVIDER_OUTPUT_PARSE_FAILED"
        | "CACHE_ERROR"
        | "UNKNOWN_ERROR";
      message: string;
      retryable: boolean;
      elapsedMs?: number;
    };

export type NativeHostStatusResponse =
  | {
      type: "NATIVE_HOST_STATUS";
      requestId: string;
      ok: true;
      status: "ready";
      hostVersion: string;
      bridgeVersion: string;
      protocolVersion: number;
      appVersion?: string;
      installPath?: string;
      message: string;
    }
  | {
      type: "NATIVE_HOST_STATUS";
      requestId: string;
      ok: false;
      status:
        | "unavailable"
        | "updateRequired"
        | "unsupportedNewer"
        | "invalidHostInfo";
      error:
        | "NATIVE_HOST_UNAVAILABLE"
        | "NATIVE_HOST_UPDATE_REQUIRED"
        | "NATIVE_HOST_UNSUPPORTED"
        | "UNKNOWN_ERROR";
      message: string;
      retryable: boolean;
    };

export type NativeHostUpdateMetadata = {
  checkedAt: number;
  nextCheckAt: number;
  failureCount: number;
  lastErrorCode?: NativeHostUpdateStoredErrorCode;
};

export type NativeHostUpdateStoredErrorCode =
  | "NATIVE_HOST_UNAVAILABLE"
  | "NATIVE_HOST_UPDATE_REQUIRED"
  | "NATIVE_HOST_UNSUPPORTED"
  | "UPDATE_UNSUPPORTED_PLATFORM"
  | "UPDATE_CHECK_FAILED"
  | "UPDATE_NOT_AVAILABLE"
  | "UPDATE_DOWNLOAD_FAILED"
  | "UPDATE_CHECKSUM_FAILED"
  | "UPDATE_INSTALL_FAILED"
  | "UPDATE_RECONNECT_FAILED"
  | "INVALID_MESSAGE"
  | "UNKNOWN_ERROR";

export type NativeHostUpdateStoredStatus =
  | (NativeHostUpdateMetadata & {
      ok: true;
      installedVersion: string;
      latestVersion: string;
      latestTag: string;
      updateAvailable: boolean;
      releaseUrl: string;
    })
  | (NativeHostUpdateMetadata & {
      ok: false;
      error: NativeHostUpdateStoredErrorCode;
      message: string;
      retryable: boolean;
      manualUpdateRequired?: boolean;
    });

export type NativeHostUpdateStatusExtensionResponse = {
  type: "NATIVE_HOST_UPDATE_STATUS";
  requestId: string;
  status?: NativeHostUpdateStoredStatus;
};

export type NativeHostUpdateApplyResponse =
  | {
      type: "NATIVE_HOST_UPDATE_RESULT";
      requestId: string;
      ok: true;
      previousVersion: string;
      installedVersion: string;
      installedPath: string;
    }
  | {
      type: "NATIVE_HOST_UPDATE_RESULT";
      requestId: string;
      ok: false;
      error:
        | "NATIVE_HOST_UNAVAILABLE"
        | "NATIVE_HOST_UPDATE_REQUIRED"
        | "NATIVE_HOST_UNSUPPORTED"
        | "UPDATE_UNSUPPORTED_PLATFORM"
        | "UPDATE_CHECK_FAILED"
        | "UPDATE_NOT_AVAILABLE"
        | "UPDATE_DOWNLOAD_FAILED"
        | "UPDATE_CHECKSUM_FAILED"
        | "UPDATE_INSTALL_FAILED"
        | "UPDATE_RECONNECT_FAILED"
        | "INVALID_MESSAGE"
        | "UNKNOWN_ERROR";
      message: string;
      retryable: boolean;
    };

export type ProviderStatusResponse =
  | {
      type: "PROVIDER_STATUS";
      requestId: string;
      ok: true;
      providers: Array<{
        id: ProviderId;
        available: boolean;
        binaryPath?: string;
        version?: string;
        error?: string;
      }>;
    }
  | {
      type: "PROVIDER_STATUS";
      requestId: string;
      ok: false;
      error: "NATIVE_HOST_UNAVAILABLE" | "UNKNOWN_ERROR";
      message: string;
      retryable: boolean;
    };

export type ProviderModelsExtensionResponse =
  | {
      type: "PROVIDER_MODELS_RESULT";
      requestId: string;
      ok: true;
      catalog: ProviderModelCatalog;
    }
  | {
      type: "PROVIDER_MODELS_RESULT";
      requestId: string;
      ok: false;
      provider: ProviderId;
      error: "NATIVE_HOST_UNAVAILABLE" | "PROVIDER_UNAVAILABLE" | "UNKNOWN_ERROR";
      message: string;
      retryable: boolean;
      fallbackCatalog: ProviderModelCatalog;
    };

export type CacheClearResponse =
  | {
      type: "CACHE_CLEAR_RESULT";
      requestId: string;
      ok: true;
      deletedRows: number;
    }
  | {
      type: "CACHE_CLEAR_RESULT";
      requestId: string;
      ok: false;
      error: "NATIVE_HOST_UNAVAILABLE" | "CACHE_ERROR" | "UNKNOWN_ERROR";
      message: string;
      retryable: boolean;
    };

export type DebugLogInfoResponse =
  | {
      type: "DEBUG_LOG_INFO_RESULT";
      requestId: string;
      ok: true;
      logPath: string;
      exists: boolean;
      sizeBytes: number;
    }
  | {
      type: "DEBUG_LOG_INFO_RESULT";
      requestId: string;
      ok: false;
      error: "NATIVE_HOST_UNAVAILABLE" | "DEBUG_LOG_ERROR" | "UNKNOWN_ERROR";
      message: string;
      retryable: boolean;
    };

export type DebugLogClearResponse =
  | {
      type: "DEBUG_LOG_CLEAR_RESULT";
      requestId: string;
      ok: true;
      logPath: string;
      exists: boolean;
      sizeBytes: number;
    }
  | {
      type: "DEBUG_LOG_CLEAR_RESULT";
      requestId: string;
      ok: false;
      error: "NATIVE_HOST_UNAVAILABLE" | "DEBUG_LOG_ERROR" | "UNKNOWN_ERROR";
      message: string;
      retryable: boolean;
    };

export type DebugLogContentResponse =
  | {
      type: "DEBUG_LOG_CONTENT_RESULT";
      requestId: string;
      ok: true;
      logPath: string;
      exists: boolean;
      sizeBytes: number;
      content: string;
      truncated: boolean;
    }
  | {
      type: "DEBUG_LOG_CONTENT_RESULT";
      requestId: string;
      ok: false;
      error: "NATIVE_HOST_UNAVAILABLE" | "DEBUG_LOG_ERROR" | "UNKNOWN_ERROR";
      message: string;
      retryable: boolean;
    };

export type DebugLogWriteResponse =
  | {
      type: "DEBUG_LOG_WRITE_RESULT";
      requestId: string;
      ok: true;
      written: boolean;
    }
  | {
      type: "DEBUG_LOG_WRITE_RESULT";
      requestId: string;
      ok: false;
      error: "NATIVE_HOST_UNAVAILABLE" | "DEBUG_LOG_ERROR" | "UNKNOWN_ERROR";
      message: string;
      retryable: boolean;
    };

export type ExtensionResponse =
  | {
      type: "PONG";
      location: string;
    }
  | NativeHostStatusResponse
  | NativeHostUpdateStatusExtensionResponse
  | NativeHostUpdateApplyResponse
  | ProviderStatusResponse
  | ProviderModelsExtensionResponse
  | CacheClearResponse
  | DebugLogInfoResponse
  | DebugLogClearResponse
  | DebugLogContentResponse
  | DebugLogWriteResponse
  | TranslationResultResponse
  | SubtitleTranslationCacheResponse
  | SubtitleTranslationResultResponse
  | {
      type: "ERROR";
      message: string;
    };
