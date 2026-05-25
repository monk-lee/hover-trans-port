import type {
  ProviderId,
  ProviderModelCatalog,
  ProviderSelection
} from "./providers";

export const NATIVE_HOST_NAME = "com.monklabs.hover_trans_port";
export const NATIVE_BRIDGE_VERSION = "0.2.12-rust-helper";
export const NATIVE_HOST_VERSION = "0.2.12";
export const NATIVE_HOST_PROTOCOL_VERSION = 1;

export type NativePingRequest = {
  type: "PING";
  requestId: string;
};

export type NativeHostInfoRequest = {
  type: "HOST_INFO";
  requestId: string;
};

export type NativeTranslateRequest = {
  type: "TRANSLATE";
  requestId: string;
  provider?: ProviderSelection;
  model?: string;
  sourceLang?: "auto" | string;
  targetLang: string;
  text: string;
  timeoutMs?: number;
  cacheEnabled?: boolean;
  debugLogging?: boolean;
  context?: {
    mode: "selection" | "hover-block";
  };
};

export type NativeProviderStatusRequest = {
  type: "PROVIDER_STATUS";
  requestId: string;
  provider?: ProviderId | ProviderSelection;
};

export type NativeProviderModelsRequest = {
  type: "PROVIDER_MODELS";
  requestId: string;
  provider?: ProviderId | ProviderSelection;
};

export type NativeClearCacheRequest = {
  type: "CLEAR_TRANSLATION_CACHE";
  requestId: string;
};

export type NativeDebugLogInfoRequest = {
  type: "GET_DEBUG_LOG_INFO";
  requestId: string;
};

export type NativeDebugLogClearRequest = {
  type: "CLEAR_DEBUG_LOG";
  requestId: string;
};

export type NativeDebugLogContentRequest = {
  type: "GET_DEBUG_LOG_CONTENT";
  requestId: string;
  maxBytes?: number;
  maxLines?: number;
};

export type NativeDebugLogPrimitive = string | number | boolean | null;

export type NativeDebugLogFields = Record<
  string,
  NativeDebugLogPrimitive | undefined
>;

export type NativeDebugLogWriteRequest = {
  type: "WRITE_DEBUG_LOG";
  requestId: string;
  event: string;
  fields?: NativeDebugLogFields;
};

export type NativeHostUpdateStatusRequest = {
  type: "NATIVE_HOST_UPDATE_STATUS";
  requestId: string;
};

export type NativeHostUpdateRequest = {
  type: "NATIVE_HOST_UPDATE";
  requestId: string;
  targetTag: string;
  targetVersion: string;
};

export type NativeRequest =
  | NativePingRequest
  | NativeHostInfoRequest
  | NativeTranslateRequest
  | NativeProviderStatusRequest
  | NativeProviderModelsRequest
  | NativeClearCacheRequest
  | NativeDebugLogInfoRequest
  | NativeDebugLogClearRequest
  | NativeDebugLogContentRequest
  | NativeDebugLogWriteRequest
  | NativeHostUpdateStatusRequest
  | NativeHostUpdateRequest;

export type NativePongResponse = {
  type: "PONG";
  requestId: string;
  ok: true;
  bridgeVersion: string;
};

export type NativeHostInfoResponse =
  | {
      type: "HOST_INFO_RESULT";
      requestId: string;
      ok: true;
      hostVersion: string;
      bridgeVersion: string;
      protocolVersion: number;
      appVersion?: string;
      installPath?: string;
    }
  | {
      type: "HOST_INFO_RESULT";
      requestId?: string;
      ok: false;
      error: "INVALID_MESSAGE";
      message: string;
      retryable: false;
    };

export type NativeProviderStatusResponse = {
  type: "PROVIDER_STATUS_RESULT";
  requestId: string;
  ok: true;
  providers: Array<{
    id: ProviderId;
    available: boolean;
    binaryPath?: string;
    version?: string;
    error?: string;
  }>;
};

export type NativeProviderModelsResponse =
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
      error: NativeErrorCode;
      message: string;
      retryable: boolean;
    };

export type NativeTranslateResultResponse =
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
      error: NativeErrorCode;
      message: string;
      retryable: boolean;
      elapsedMs?: number;
    };

export type NativeCacheClearResponse =
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
      error: "CACHE_ERROR" | "INVALID_MESSAGE";
      message: string;
      retryable: boolean;
    };

export type NativeDebugLogInfoResponse =
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
      error: "DEBUG_LOG_ERROR" | "INVALID_MESSAGE";
      message: string;
      retryable: boolean;
    };

export type NativeDebugLogClearResponse =
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
      error: "DEBUG_LOG_ERROR" | "INVALID_MESSAGE";
      message: string;
      retryable: boolean;
    };

export type NativeDebugLogContentResponse =
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
      error: "DEBUG_LOG_ERROR" | "INVALID_MESSAGE";
      message: string;
      retryable: boolean;
    };

export type NativeDebugLogWriteResponse =
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
      error: "DEBUG_LOG_ERROR" | "INVALID_MESSAGE";
      message: string;
      retryable: boolean;
    };

export type NativeHostUpdateErrorCode =
  | "UPDATE_UNSUPPORTED_PLATFORM"
  | "UPDATE_CHECK_FAILED"
  | "UPDATE_NOT_AVAILABLE"
  | "UPDATE_DOWNLOAD_FAILED"
  | "UPDATE_CHECKSUM_FAILED"
  | "UPDATE_INSTALL_FAILED"
  | "UPDATE_RECONNECT_FAILED";

export type NativeHostUpdateStatusResponse =
  | {
      type: "NATIVE_HOST_UPDATE_STATUS_RESULT";
      requestId: string;
      ok: true;
      installedVersion: string;
      latestVersion: string;
      latestTag: string;
      updateAvailable: boolean;
      releaseUrl: string;
    }
  | {
      type: "NATIVE_HOST_UPDATE_STATUS_RESULT";
      requestId: string;
      ok: false;
      error: NativeHostUpdateErrorCode | "INVALID_MESSAGE" | "UNSUPPORTED_MESSAGE";
      message: string;
      retryable: boolean;
    };

export type NativeHostUpdateResponse =
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
      error: NativeHostUpdateErrorCode | "INVALID_MESSAGE" | "UNSUPPORTED_MESSAGE";
      message: string;
      retryable: boolean;
    };

export type NativeErrorCode =
  | "INVALID_MESSAGE"
  | "UNSUPPORTED_MESSAGE"
  | "NATIVE_HOST_UNAVAILABLE"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_EXIT_NONZERO"
  | "PROVIDER_OUTPUT_PARSE_FAILED"
  | "CACHE_ERROR"
  | "DEBUG_LOG_ERROR";

export type NativeErrorResponse = {
  type: "ERROR";
  requestId?: string;
  ok: false;
  error: NativeErrorCode;
  message: string;
  retryable: boolean;
};

export type NativeResponse =
  | NativePongResponse
  | NativeHostInfoResponse
  | NativeProviderStatusResponse
  | NativeProviderModelsResponse
  | NativeTranslateResultResponse
  | NativeCacheClearResponse
  | NativeDebugLogInfoResponse
  | NativeDebugLogClearResponse
  | NativeDebugLogContentResponse
  | NativeDebugLogWriteResponse
  | NativeHostUpdateStatusResponse
  | NativeHostUpdateResponse
  | NativeErrorResponse;
