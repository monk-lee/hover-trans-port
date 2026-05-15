import {
  NATIVE_HOST_NAME,
  type NativeCacheClearResponse,
  type NativeDebugLogClearResponse,
  type NativeDebugLogContentResponse,
  type NativeDebugLogInfoResponse,
  type NativeDebugLogWriteResponse,
  type NativeHostInfoResponse,
  type NativeHostUpdateErrorCode,
  type NativeHostUpdateResponse,
  type NativeHostUpdateStatusResponse,
  type NativeProviderModelsResponse,
  type NativeProviderStatusResponse,
  type NativePongResponse,
  type NativeRequest,
  type NativeResponse,
  type NativeTranslateResultResponse
} from "../shared/nativeProtocol";
import type {
  NativeHostUpdateApplyResponse,
  NativeHostUpdateStoredStatus,
  TranslationTarget
} from "../shared/messages";
import { evaluateNativeHostCompatibility } from "../shared/nativeHostCompatibility";
import type {
  ProviderId,
  ProviderModelCatalog,
  ProviderSelection
} from "../shared/providers";
import {
  getFallbackModelCatalog,
  getProviderLabel,
  resolveProviderForModel
} from "../shared/providers";
import {
  DEFAULT_CACHE_ENABLED,
  DEFAULT_DEBUG_LOGGING,
  DEFAULT_TIMEOUT_MS,
  getBrowserTargetLang,
  getModelForProvider,
  normalizeCacheEnabled,
  normalizeDebugLogging,
  normalizeProvider,
  normalizeTargetLang,
  normalizeTimeoutMs,
  type StoredOptions
} from "../shared/options";

const NATIVE_HOST_TIMEOUT_MS = 5000;
const NATIVE_HOST_UPDATE_STATUS_TIMEOUT_MS = 15000;
const NATIVE_HOST_UPDATE_TIMEOUT_MS = 130000;
const NATIVE_TRANSLATION_OVERHEAD_MS = 5000;
const STATUS_CHECK_MAX_ATTEMPTS = 3;
const STATUS_CHECK_INITIAL_RETRY_DELAY_MS = 300;
const STATUS_CHECK_BACKOFF_FACTOR = 3;

type ExtensionTranslationError =
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

export type NativeHostStatus =
  | {
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

export type ProviderStatus =
  | {
      ok: true;
      providers: NativeProviderStatusResponse["providers"];
    }
  | {
      ok: false;
      error: "NATIVE_HOST_UNAVAILABLE" | "UNKNOWN_ERROR";
      message: string;
      retryable: boolean;
    };

export type ProviderModelsStatus =
  | {
      ok: true;
      catalog: ProviderModelCatalog;
    }
  | {
      ok: false;
      provider: ProviderId;
      error: "NATIVE_HOST_UNAVAILABLE" | "PROVIDER_UNAVAILABLE" | "UNKNOWN_ERROR";
      message: string;
      retryable: boolean;
      fallbackCatalog: ProviderModelCatalog;
    };

export type NativeTranslationStatus =
  | {
      ok: true;
      provider: ProviderId;
      translatedText: string;
      cached: boolean;
      elapsedMs: number;
    }
  | {
      ok: false;
      provider?: ProviderId;
      error: ExtensionTranslationError;
      message: string;
      retryable: boolean;
      elapsedMs?: number;
    };

type DebugLogError =
  | "NATIVE_HOST_UNAVAILABLE"
  | "DEBUG_LOG_ERROR"
  | "UNKNOWN_ERROR";

export type DebugLogInfoStatus =
  | {
      ok: true;
      logPath: string;
      exists: boolean;
      sizeBytes: number;
    }
  | {
      ok: false;
      error: DebugLogError;
      message: string;
      retryable: boolean;
    };

export type DebugLogClearStatus = DebugLogInfoStatus;

export type DebugLogContentStatus =
  | {
      ok: true;
      logPath: string;
      exists: boolean;
      sizeBytes: number;
      content: string;
      truncated: boolean;
    }
  | {
      ok: false;
      error: DebugLogError;
      message: string;
      retryable: boolean;
    };

export type DebugLogWriteStatus =
  | {
      ok: true;
      written: boolean;
    }
  | {
      ok: false;
      error: DebugLogError;
      message: string;
      retryable: boolean;
    };

type NativeHostUpdateApplyStatus =
  | Omit<Extract<NativeHostUpdateApplyResponse, { ok: true }>, "type" | "requestId">
  | Omit<Extract<NativeHostUpdateApplyResponse, { ok: false }>, "type" | "requestId">;

function createUnavailableStatus(message: string): NativeHostStatus {
  return {
    ok: false,
    status: "unavailable",
    error: "NATIVE_HOST_UNAVAILABLE",
    message,
    retryable: true
  };
}

function createProviderStatusUnavailable(message: string): ProviderStatus {
  return {
    ok: false,
    error: "NATIVE_HOST_UNAVAILABLE",
    message,
    retryable: true
  };
}

function createTranslationUnavailable(message: string): NativeTranslationStatus {
  return {
    ok: false,
    error: "NATIVE_HOST_UNAVAILABLE",
    message: toUserFacingTranslationMessage("NATIVE_HOST_UNAVAILABLE", message),
    retryable: true
  };
}

function isNativePong(response: NativeResponse): response is NativePongResponse {
  return response.type === "PONG" && response.ok === true;
}

function isHostInfo(
  response: NativeResponse
): response is NativeHostInfoResponse {
  return response.type === "HOST_INFO_RESULT";
}

function isProviderStatus(
  response: NativeResponse
): response is NativeProviderStatusResponse {
  return response.type === "PROVIDER_STATUS_RESULT" && response.ok === true;
}

function isProviderModelsResult(
  response: NativeResponse
): response is NativeProviderModelsResponse {
  return response.type === "PROVIDER_MODELS_RESULT";
}

function isTranslateResult(
  response: NativeResponse
): response is NativeTranslateResultResponse {
  return response.type === "TRANSLATE_RESULT";
}

function isCacheClearResult(
  response: NativeResponse
): response is NativeCacheClearResponse {
  return response.type === "CACHE_CLEAR_RESULT";
}

function isDebugLogInfoResult(
  response: NativeResponse
): response is NativeDebugLogInfoResponse {
  return response.type === "DEBUG_LOG_INFO_RESULT";
}

function isDebugLogClearResult(
  response: NativeResponse
): response is NativeDebugLogClearResponse {
  return response.type === "DEBUG_LOG_CLEAR_RESULT";
}

function isDebugLogContentResult(
  response: NativeResponse
): response is NativeDebugLogContentResponse {
  return response.type === "DEBUG_LOG_CONTENT_RESULT";
}

function isDebugLogWriteResult(
  response: NativeResponse
): response is NativeDebugLogWriteResponse {
  return response.type === "DEBUG_LOG_WRITE_RESULT";
}

function isNativeHostUpdateStatusResult(
  response: NativeResponse
): response is NativeHostUpdateStatusResponse {
  return response.type === "NATIVE_HOST_UPDATE_STATUS_RESULT";
}

function isNativeHostUpdateResult(
  response: NativeResponse
): response is NativeHostUpdateResponse {
  return response.type === "NATIVE_HOST_UPDATE_RESULT";
}

function isUnsupportedHostInfoError(response: NativeResponse): boolean {
  return response.type === "ERROR" && response.error === "UNSUPPORTED_MESSAGE";
}

function appendProviderDetail(summary: string, fallback: string): string {
  const detail = fallback.trim();

  if (!detail || detail === summary) {
    return summary;
  }

  return `${summary} ${detail}`;
}

function toUserFacingTranslationMessage(
  error: string,
  fallback: string,
  provider?: ProviderId | ProviderSelection
): string {
  const providerLabel = provider ? getProviderLabel(provider) : "Provider";

  switch (error) {
    case "PROVIDER_NOT_FOUND":
      return appendProviderDetail(
        `${providerLabel}를 찾을 수 없습니다.`,
        fallback
      );
    case "PROVIDER_TIMEOUT":
      return appendProviderDetail(
        `${providerLabel} 번역 시간이 초과되었습니다.`,
        fallback
      );
    case "PROVIDER_EXIT_NONZERO":
      return appendProviderDetail(
        `${providerLabel} 실행에 실패했습니다.`,
        fallback
      );
    case "PROVIDER_OUTPUT_PARSE_FAILED":
      return appendProviderDetail(
        `${providerLabel} 번역 결과를 읽지 못했습니다.`,
        fallback
      );
    case "CACHE_ERROR":
      return "번역 캐시를 처리하지 못했습니다.";
    case "NATIVE_HOST_UNAVAILABLE":
      return "Native Host에 연결할 수 없습니다.";
    case "NATIVE_HOST_UPDATE_REQUIRED":
      return "Native Host 업데이트가 필요합니다.";
    case "NATIVE_HOST_UNSUPPORTED":
      return "Native Host 버전이 이 확장 프로그램과 호환되지 않습니다.";
    default:
      return fallback || "번역에 실패했습니다.";
  }
}

function toExtensionTranslationError(error: string): ExtensionTranslationError {
  switch (error) {
    case "NO_TRANSLATION_TARGET":
    case "NATIVE_HOST_UNAVAILABLE":
    case "NATIVE_HOST_UPDATE_REQUIRED":
    case "NATIVE_HOST_UNSUPPORTED":
    case "PROVIDER_NOT_FOUND":
    case "PROVIDER_UNAVAILABLE":
    case "PROVIDER_TIMEOUT":
    case "PROVIDER_EXIT_NONZERO":
    case "PROVIDER_OUTPUT_PARSE_FAILED":
    case "CACHE_ERROR":
      return error;
    default:
      return "UNKNOWN_ERROR";
  }
}

function toExtensionDebugLogError(error: string): DebugLogError {
  return error === "DEBUG_LOG_ERROR" ? "DEBUG_LOG_ERROR" : "UNKNOWN_ERROR";
}

function toNativeHostUpdateStoredError(
  error: string
): Extract<NativeHostUpdateStoredStatus, { ok: false }>["error"] {
  switch (error) {
    case "UPDATE_UNSUPPORTED_PLATFORM":
    case "UPDATE_CHECK_FAILED":
    case "UPDATE_NOT_AVAILABLE":
    case "UPDATE_DOWNLOAD_FAILED":
    case "UPDATE_CHECKSUM_FAILED":
    case "UPDATE_INSTALL_FAILED":
    case "UPDATE_RECONNECT_FAILED":
    case "INVALID_MESSAGE":
      return error;
    case "UNSUPPORTED_MESSAGE":
      return "NATIVE_HOST_UPDATE_REQUIRED";
    default:
      return "UNKNOWN_ERROR";
  }
}

function toNativeHostUpdateApplyError(
  error: string
): Extract<NativeHostUpdateApplyResponse, { ok: false }>["error"] {
  switch (error) {
    case "UPDATE_UNSUPPORTED_PLATFORM":
    case "UPDATE_CHECK_FAILED":
    case "UPDATE_NOT_AVAILABLE":
    case "UPDATE_DOWNLOAD_FAILED":
    case "UPDATE_CHECKSUM_FAILED":
    case "UPDATE_INSTALL_FAILED":
    case "UPDATE_RECONNECT_FAILED":
    case "INVALID_MESSAGE":
      return error;
    case "UNSUPPORTED_MESSAGE":
      return "NATIVE_HOST_UPDATE_REQUIRED";
    default:
      return "UNKNOWN_ERROR";
  }
}

function isNativeHostUpdateErrorCode(
  error: string
): error is NativeHostUpdateErrorCode {
  return (
    error === "UPDATE_UNSUPPORTED_PLATFORM" ||
    error === "UPDATE_CHECK_FAILED" ||
    error === "UPDATE_NOT_AVAILABLE" ||
    error === "UPDATE_DOWNLOAD_FAILED" ||
    error === "UPDATE_CHECKSUM_FAILED" ||
    error === "UPDATE_INSTALL_FAILED" ||
    error === "UPDATE_RECONNECT_FAILED"
  );
}

function nativeHostStatusFromHostInfo(
  response: NativeHostInfoResponse
): NativeHostStatus {
  if (!response.ok) {
    return {
      ok: false,
      status: "invalidHostInfo",
      error: "UNKNOWN_ERROR",
      message: response.message,
      retryable: false
    };
  }

  const compatibility = evaluateNativeHostCompatibility(response);

  if (compatibility.ok) {
    return {
      ok: true,
      status: "ready",
      hostVersion: response.hostVersion,
      bridgeVersion: response.bridgeVersion,
      protocolVersion: response.protocolVersion,
      appVersion: response.appVersion,
      installPath: response.installPath,
      message: compatibility.message
    };
  }

  if (compatibility.status === "updateRequired") {
    return {
      ok: false,
      status: "updateRequired",
      error: "NATIVE_HOST_UPDATE_REQUIRED",
      message: compatibility.message,
      retryable: false
    };
  }

  if (compatibility.status === "unsupportedNewer") {
    return {
      ok: false,
      status: "unsupportedNewer",
      error: "NATIVE_HOST_UNSUPPORTED",
      message: compatibility.message,
      retryable: false
    };
  }

  return {
    ok: false,
    status: "invalidHostInfo",
    error: "UNKNOWN_ERROR",
    message: compatibility.message,
    retryable: true
  };
}

function createTranslationBlockedByNativeHost(
  status: Extract<NativeHostStatus, { ok: false }>
): NativeTranslationStatus {
  return {
    ok: false,
    error:
      status.error === "NATIVE_HOST_UPDATE_REQUIRED" ||
      status.error === "NATIVE_HOST_UNSUPPORTED"
        ? status.error
        : "NATIVE_HOST_UNAVAILABLE",
    message: toUserFacingTranslationMessage(status.error, status.message),
    retryable: status.retryable
  };
}

function sendNativeHostMessage(
  request: NativeRequest,
  timeoutMs = NATIVE_HOST_TIMEOUT_MS
): Promise<NativeResponse | undefined> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      resolve(undefined);
    }, timeoutMs);

    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, request, (response) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (chrome.runtime.lastError) {
        reject(
          new Error(
            chrome.runtime.lastError.message ?? "Native host unavailable."
          )
        );
        return;
      }

      resolve(response as NativeResponse | undefined);
    });
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getBrowserLocaleCandidates(): Array<string | undefined> {
  const chromeLanguage =
    typeof chrome !== "undefined" && chrome.i18n?.getUILanguage
      ? chrome.i18n.getUILanguage()
      : undefined;
  const navigatorLanguage =
    typeof navigator !== "undefined" ? navigator.language : undefined;

  return [chromeLanguage, navigatorLanguage];
}

function isRetryableStatusCheckFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes("native host") ||
    message.includes("native messaging") ||
    message.includes("specified native messaging host") ||
    message.includes("host not found") ||
    message.includes("not found") ||
    message.includes("not reachable")
  );
}

async function sendStatusCheckMessageWithRetry(
  request: NativeRequest,
  timeoutMs = NATIVE_HOST_TIMEOUT_MS
): Promise<NativeResponse | undefined> {
  let retryDelayMs = STATUS_CHECK_INITIAL_RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= STATUS_CHECK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await sendNativeHostMessage(request, timeoutMs);

      if (response || attempt === STATUS_CHECK_MAX_ATTEMPTS) {
        return response;
      }
    } catch (error) {
      if (
        attempt === STATUS_CHECK_MAX_ATTEMPTS ||
        !isRetryableStatusCheckFailure(error)
      ) {
        throw error;
      }
    }

    await wait(retryDelayMs);
    retryDelayMs *= STATUS_CHECK_BACKOFF_FACTOR;
  }

  return undefined;
}

export async function checkNativeHost(
  requestId: string
): Promise<NativeHostStatus> {
  const request: NativeRequest = {
    type: "HOST_INFO",
    requestId
  };

  try {
    const response = await sendStatusCheckMessageWithRetry(request);

    if (response && isHostInfo(response) && response.requestId === requestId) {
      return nativeHostStatusFromHostInfo(response);
    }

    if (!response) {
      return createUnavailableStatus("Native host did not respond.");
    }

    if (isUnsupportedHostInfoError(response)) {
      return {
        ok: false,
        status: "updateRequired",
        error: "NATIVE_HOST_UPDATE_REQUIRED",
        message:
          "Native Host update required. Installed host does not support version handshake.",
        retryable: false
      };
    }

    return {
      ok: false,
      status: "invalidHostInfo",
      error: "UNKNOWN_ERROR",
      message: "Native host returned an invalid HOST_INFO response.",
      retryable: true
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Native host unavailable.";

    return createUnavailableStatus(message);
  }
}

export async function checkProviderStatus(
  requestId: string
): Promise<ProviderStatus> {
  const request: NativeRequest = {
    type: "PROVIDER_STATUS",
    requestId
  };

  try {
    const response = await sendStatusCheckMessageWithRetry(request);

    if (
      response &&
      isProviderStatus(response) &&
      response.requestId === requestId
    ) {
      return {
        ok: true,
        providers: response.providers
      };
    }

    if (!response) {
      return createProviderStatusUnavailable("Native host did not respond.");
    }

    return {
      ok: false,
      error: "UNKNOWN_ERROR",
      message: "Native host returned an invalid provider status response.",
      retryable: true
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Native host unavailable.";

    return createProviderStatusUnavailable(message);
  }
}

export async function checkNativeHostUpdateStatus(
  requestId: string
): Promise<NativeHostUpdateStoredStatus> {
  const checkedAt = Date.now();
  const request: NativeRequest = {
    type: "NATIVE_HOST_UPDATE_STATUS",
    requestId
  };

  try {
    const response = await sendStatusCheckMessageWithRetry(
      request,
      NATIVE_HOST_UPDATE_STATUS_TIMEOUT_MS
    );

    if (
      response &&
      isNativeHostUpdateStatusResult(response) &&
      response.requestId === requestId &&
      response.ok
    ) {
      return {
        checkedAt,
        ok: true,
        installedVersion: response.installedVersion,
        latestVersion: response.latestVersion,
        latestTag: response.latestTag,
        updateAvailable: response.updateAvailable,
        releaseUrl: response.releaseUrl
      };
    }

    if (
      response &&
      isNativeHostUpdateStatusResult(response) &&
      response.requestId === requestId &&
      !response.ok
    ) {
      if (response.error === "UNSUPPORTED_MESSAGE") {
        return {
          checkedAt,
          ok: false,
          error: "NATIVE_HOST_UPDATE_REQUIRED",
          message:
            "One manual native host update is required before in-app updates are available.",
          retryable: false,
          manualUpdateRequired: true
        };
      }

      if (response.error === "INVALID_MESSAGE") {
        return {
          checkedAt,
          ok: false,
          error: "INVALID_MESSAGE",
          message: response.message || "Native host update status request was invalid.",
          retryable: false
        };
      }

      return {
        checkedAt,
        ok: false,
        error: toNativeHostUpdateStoredError(response.error),
        message: response.message,
        retryable: response.retryable
      };
    }

    if (
      response?.type === "ERROR" &&
      response.requestId === requestId &&
      response.error === "UNSUPPORTED_MESSAGE"
    ) {
      return {
        checkedAt,
        ok: false,
        error: "NATIVE_HOST_UPDATE_REQUIRED",
        message:
          "One manual native host update is required before in-app updates are available.",
        retryable: false,
        manualUpdateRequired: true
      };
    }

    if (
      response?.type === "ERROR" &&
      response.requestId === requestId &&
      response.error === "INVALID_MESSAGE"
    ) {
      return {
        checkedAt,
        ok: false,
        error: "INVALID_MESSAGE",
        message: response.message || "Native host update status request was invalid.",
        retryable: false
      };
    }

    if (!response) {
      return {
        checkedAt,
        ok: false,
        error: "NATIVE_HOST_UNAVAILABLE",
        message: "Native host did not respond.",
        retryable: true
      };
    }

    return {
      checkedAt,
      ok: false,
      error: "UNKNOWN_ERROR",
      message: "Native host returned an invalid update status response.",
      retryable: true
    };
  } catch (error) {
    return {
      checkedAt,
      ok: false,
      error: "NATIVE_HOST_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Native host unavailable.",
      retryable: true
    };
  }
}

export async function updateNativeHost(
  requestId: string,
  targetTag: string,
  targetVersion: string
): Promise<NativeHostUpdateApplyStatus> {
  const request: NativeRequest = {
    type: "NATIVE_HOST_UPDATE",
    requestId,
    targetTag,
    targetVersion
  };

  try {
    const response = await sendNativeHostMessage(
      request,
      NATIVE_HOST_UPDATE_TIMEOUT_MS
    );

    if (
      response &&
      isNativeHostUpdateResult(response) &&
      response.requestId === requestId &&
      response.ok
    ) {
      return {
        ok: true,
        previousVersion: response.previousVersion,
        installedVersion: response.installedVersion,
        installedPath: response.installedPath
      };
    }

    if (
      response &&
      isNativeHostUpdateResult(response) &&
      response.requestId === requestId &&
      !response.ok
    ) {
      if (response.error === "UNSUPPORTED_MESSAGE") {
        return {
          ok: false,
          error: "NATIVE_HOST_UPDATE_REQUIRED",
          message:
            "One manual native host update is required before in-app updates are available.",
          retryable: false
        };
      }

      if (response.error === "INVALID_MESSAGE") {
        return {
          ok: false,
          error: "INVALID_MESSAGE",
          message: response.message || "Native host update request was invalid.",
          retryable: false
        };
      }

      return {
        ok: false,
        error: isNativeHostUpdateErrorCode(response.error)
          ? response.error
          : toNativeHostUpdateApplyError(response.error),
        message: response.message,
        retryable: response.retryable
      };
    }

    if (
      response?.type === "ERROR" &&
      response.requestId === requestId &&
      response.error === "UNSUPPORTED_MESSAGE"
    ) {
      return {
        ok: false,
        error: "NATIVE_HOST_UPDATE_REQUIRED",
        message:
          "One manual native host update is required before in-app updates are available.",
        retryable: false
      };
    }

    if (
      response?.type === "ERROR" &&
      response.requestId === requestId &&
      response.error === "INVALID_MESSAGE"
    ) {
      return {
        ok: false,
        error: "INVALID_MESSAGE",
        message: response.message || "Native host update request was invalid.",
        retryable: false
      };
    }

    if (!response) {
      return {
        ok: false,
        error: "NATIVE_HOST_UNAVAILABLE",
        message: "Native host did not respond.",
        retryable: true
      };
    }

    return {
      ok: false,
      error: "UNKNOWN_ERROR",
      message: "Native host returned an invalid update response.",
      retryable: true
    };
  } catch (error) {
    return {
      ok: false,
      error: "NATIVE_HOST_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Native host unavailable.",
      retryable: true
    };
  }
}

export async function getProviderModels(
  requestId: string,
  provider: ProviderSelection
): Promise<ProviderModelsStatus> {
  const providerId = resolveProviderForModel(provider);
  const fallbackCatalog = getFallbackModelCatalog(providerId);
  const request: NativeRequest = {
    type: "PROVIDER_MODELS",
    requestId,
    provider
  };

  try {
    const response = await sendStatusCheckMessageWithRetry(request);

    if (
      response &&
      isProviderModelsResult(response) &&
      response.ok &&
      response.requestId === requestId &&
      response.catalog.provider === providerId
    ) {
      return {
        ok: true,
        catalog: response.catalog
      };
    }

    if (!response) {
      return {
        ok: false,
        provider: providerId,
        error: "NATIVE_HOST_UNAVAILABLE",
        message: "Native host did not respond. Showing fallback model aliases.",
        retryable: true,
        fallbackCatalog
      };
    }

    return {
      ok: false,
      provider: providerId,
      error: "PROVIDER_UNAVAILABLE",
      message:
        "Provider model catalog is not available. Showing fallback model aliases.",
      retryable: true,
      fallbackCatalog
    };
  } catch (error) {
    return {
      ok: false,
      provider: providerId,
      error: "NATIVE_HOST_UNAVAILABLE",
      message:
        error instanceof Error
          ? error.message
          : "Native host is not available. Showing fallback model aliases.",
      retryable: true,
      fallbackCatalog
    };
  }
}

export async function translateWithNativeHost(
  requestId: string,
  target: TranslationTarget
): Promise<NativeTranslationStatus> {
  const text = target.text.trim();
  const options = (await chrome.storage.local.get(
    "hoverTransPort"
  )) as StoredOptions;
  const selectedProvider = normalizeProvider(options.hoverTransPort?.provider);
  const selectedModel = getModelForProvider(
    options.hoverTransPort,
    selectedProvider
  );
  const selectedTargetLang = normalizeTargetLang(
    options.hoverTransPort?.targetLang,
    getBrowserTargetLang(getBrowserLocaleCandidates())
  );
  const timeoutMs = normalizeTimeoutMs(options.hoverTransPort?.timeoutMs);
  const cacheEnabled = normalizeCacheEnabled(
    options.hoverTransPort?.cacheEnabled
  );
  const debugLogging = normalizeDebugLogging(
    options.hoverTransPort?.debugLogging
  );

  if (text.length < 2) {
    return {
      ok: false,
      error: "NO_TRANSLATION_TARGET",
      message: "번역할 텍스트를 찾지 못했습니다.",
      retryable: false
    };
  }

  const nativeHostStatus = await checkNativeHost(`${requestId}:host-info`);

  if (!nativeHostStatus.ok) {
    return createTranslationBlockedByNativeHost(nativeHostStatus);
  }

  const request: NativeRequest = {
    type: "TRANSLATE",
    requestId,
    provider: selectedProvider,
    model: selectedModel,
    sourceLang: "auto",
    targetLang: selectedTargetLang,
    text,
    timeoutMs: timeoutMs || DEFAULT_TIMEOUT_MS,
    cacheEnabled:
      typeof cacheEnabled === "boolean" ? cacheEnabled : DEFAULT_CACHE_ENABLED,
    debugLogging:
      typeof debugLogging === "boolean" ? debugLogging : DEFAULT_DEBUG_LOGGING,
    context: {
      mode: target.mode
    }
  };

  try {
    const response = await sendNativeHostMessage(
      request,
      timeoutMs + NATIVE_TRANSLATION_OVERHEAD_MS
    );

    if (!response) {
      return createTranslationUnavailable("Native host did not respond.");
    }

    if (
      isTranslateResult(response) &&
      response.requestId === requestId &&
      response.ok
    ) {
      return {
        ok: true,
        provider: response.provider,
        translatedText: response.translatedText,
        cached: response.cached,
        elapsedMs: response.elapsedMs
      };
    }

    if (
      isTranslateResult(response) &&
      response.requestId === requestId &&
      !response.ok
    ) {
      return {
        ok: false,
        provider: response.provider,
        error: toExtensionTranslationError(response.error),
        message: toUserFacingTranslationMessage(
          response.error,
          response.message,
          response.provider ?? selectedProvider
        ),
        retryable: response.retryable,
        elapsedMs: response.elapsedMs
      };
    }

    if (response.type === "ERROR") {
      return {
        ok: false,
        error: toExtensionTranslationError(response.error),
        message: toUserFacingTranslationMessage(
          response.error,
          response.message,
          selectedProvider
        ),
        retryable: response.retryable
      };
    }

    return {
      ok: false,
      error: "UNKNOWN_ERROR",
      message: "번역 결과를 받지 못했습니다.",
      retryable: true
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Native host unavailable.";

    return createTranslationUnavailable(message);
  }
}

export async function clearTranslationCache(
  requestId: string
): Promise<
  | { ok: true; deletedRows: number }
  | {
      ok: false;
      error: "NATIVE_HOST_UNAVAILABLE" | "CACHE_ERROR" | "UNKNOWN_ERROR";
      message: string;
      retryable: boolean;
    }
> {
  const request: NativeRequest = {
    type: "CLEAR_TRANSLATION_CACHE",
    requestId
  };

  try {
    const response = await sendNativeHostMessage(request);

    if (
      response &&
      isCacheClearResult(response) &&
      response.requestId === requestId &&
      response.ok
    ) {
      return {
        ok: true,
        deletedRows: response.deletedRows
      };
    }

    if (
      response &&
      isCacheClearResult(response) &&
      response.requestId === requestId &&
      !response.ok
    ) {
      return {
        ok: false,
        error:
          response.error === "CACHE_ERROR" ? "CACHE_ERROR" : "UNKNOWN_ERROR",
        message: response.message,
        retryable: response.retryable
      };
    }

    if (!response) {
      return {
        ok: false,
        error: "NATIVE_HOST_UNAVAILABLE",
        message: "Native host did not respond.",
        retryable: true
      };
    }

    return {
      ok: false,
      error: "UNKNOWN_ERROR",
      message: "Native host returned an invalid cache clear response.",
      retryable: true
    };
  } catch (error) {
    return {
      ok: false,
      error: "NATIVE_HOST_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Native host unavailable.",
      retryable: true
    };
  }
}

export async function getDebugLogInfo(
  requestId: string
): Promise<DebugLogInfoStatus> {
  const request: NativeRequest = {
    type: "GET_DEBUG_LOG_INFO",
    requestId
  };

  try {
    const response = await sendNativeHostMessage(request);

    if (
      response &&
      isDebugLogInfoResult(response) &&
      response.requestId === requestId &&
      response.ok
    ) {
      return {
        ok: true,
        logPath: response.logPath,
        exists: response.exists,
        sizeBytes: response.sizeBytes
      };
    }

    if (
      response &&
      isDebugLogInfoResult(response) &&
      response.requestId === requestId &&
      !response.ok
    ) {
      return {
        ok: false,
        error: toExtensionDebugLogError(response.error),
        message: response.message,
        retryable: response.retryable
      };
    }

    if (!response) {
      return {
        ok: false,
        error: "NATIVE_HOST_UNAVAILABLE",
        message: "Native host did not respond.",
        retryable: true
      };
    }

    return {
      ok: false,
      error: "UNKNOWN_ERROR",
      message: "Native host returned an invalid debug log info response.",
      retryable: true
    };
  } catch (error) {
    return {
      ok: false,
      error: "NATIVE_HOST_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Native host unavailable.",
      retryable: true
    };
  }
}

export async function clearDebugLog(
  requestId: string
): Promise<DebugLogClearStatus> {
  const request: NativeRequest = {
    type: "CLEAR_DEBUG_LOG",
    requestId
  };

  try {
    const response = await sendNativeHostMessage(request);

    if (
      response &&
      isDebugLogClearResult(response) &&
      response.requestId === requestId &&
      response.ok
    ) {
      return {
        ok: true,
        logPath: response.logPath,
        exists: response.exists,
        sizeBytes: response.sizeBytes
      };
    }

    if (
      response &&
      isDebugLogClearResult(response) &&
      response.requestId === requestId &&
      !response.ok
    ) {
      return {
        ok: false,
        error: toExtensionDebugLogError(response.error),
        message: response.message,
        retryable: response.retryable
      };
    }

    if (!response) {
      return {
        ok: false,
        error: "NATIVE_HOST_UNAVAILABLE",
        message: "Native host did not respond.",
        retryable: true
      };
    }

    return {
      ok: false,
      error: "UNKNOWN_ERROR",
      message: "Native host returned an invalid debug log clear response.",
      retryable: true
    };
  } catch (error) {
    return {
      ok: false,
      error: "NATIVE_HOST_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Native host unavailable.",
      retryable: true
    };
  }
}

export async function getDebugLogContent(
  requestId: string,
  { maxBytes, maxLines }: { maxBytes?: number; maxLines?: number } = {}
): Promise<DebugLogContentStatus> {
  const request: NativeRequest = {
    type: "GET_DEBUG_LOG_CONTENT",
    requestId,
    maxBytes,
    maxLines
  };

  try {
    const response = await sendNativeHostMessage(request);

    if (
      response &&
      isDebugLogContentResult(response) &&
      response.requestId === requestId &&
      response.ok
    ) {
      return {
        ok: true,
        logPath: response.logPath,
        exists: response.exists,
        sizeBytes: response.sizeBytes,
        content: response.content,
        truncated: response.truncated
      };
    }

    if (
      response &&
      isDebugLogContentResult(response) &&
      response.requestId === requestId &&
      !response.ok
    ) {
      return {
        ok: false,
        error: toExtensionDebugLogError(response.error),
        message: response.message,
        retryable: response.retryable
      };
    }

    if (!response) {
      return {
        ok: false,
        error: "NATIVE_HOST_UNAVAILABLE",
        message: "Native host did not respond.",
        retryable: true
      };
    }

    return {
      ok: false,
      error: "UNKNOWN_ERROR",
      message: "Native host returned an invalid debug log content response.",
      retryable: true
    };
  } catch (error) {
    return {
      ok: false,
      error: "NATIVE_HOST_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Native host unavailable.",
      retryable: true
    };
  }
}

export async function writeDebugLogEvent(
  requestId: string,
  event: string,
  fields: Record<string, string | number | boolean | null | undefined> = {}
): Promise<DebugLogWriteStatus> {
  const options = (await chrome.storage.local.get(
    "hoverTransPort"
  )) as StoredOptions;
  const debugLogging = normalizeDebugLogging(
    options.hoverTransPort?.debugLogging
  );

  if (!debugLogging) {
    return {
      ok: true,
      written: false
    };
  }

  const request: NativeRequest = {
    type: "WRITE_DEBUG_LOG",
    requestId,
    event,
    fields
  };

  try {
    const response = await sendNativeHostMessage(request);

    if (
      response &&
      isDebugLogWriteResult(response) &&
      response.requestId === requestId &&
      response.ok
    ) {
      return {
        ok: true,
        written: response.written
      };
    }

    if (
      response &&
      isDebugLogWriteResult(response) &&
      response.requestId === requestId &&
      !response.ok
    ) {
      return {
        ok: false,
        error: toExtensionDebugLogError(response.error),
        message: response.message,
        retryable: response.retryable
      };
    }

    if (!response) {
      return {
        ok: false,
        error: "NATIVE_HOST_UNAVAILABLE",
        message: "Native host did not respond.",
        retryable: true
      };
    }

    return {
      ok: false,
      error: "UNKNOWN_ERROR",
      message: "Native host returned an invalid debug log write response.",
      retryable: true
    };
  } catch (error) {
    return {
      ok: false,
      error: "NATIVE_HOST_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Native host unavailable.",
      retryable: true
    };
  }
}
