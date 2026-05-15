import type {
  ExtensionRequest,
  ExtensionResponse,
  NativeHostUpdateStoredStatus
} from "../shared/messages";
import {
  createNativeHostUpdateMetadata,
  isNativeHostUpdateRefreshDue,
  nativeHostUpdateNeedsAttention
} from "../shared/nativeHostUpdate";
import {
  getFallbackModelCatalog,
  resolveProviderForModel
} from "../shared/providers";
import {
  DEFAULT_CACHE_ENABLED,
  DEFAULT_DEBUG_LOGGING,
  DEFAULT_EXTENSION_ENABLED,
  DEFAULT_TIMEOUT_MS,
  normalizeNativeHostUpdateAutoCheck,
  type StoredOptions
} from "../shared/options";
import {
  checkNativeHost,
  checkNativeHostUpdateStatus,
  checkProviderStatus,
  clearDebugLog,
  clearTranslationCache,
  getDebugLogContent,
  getDebugLogInfo,
  getProviderModels,
  translateWithNativeHost,
  updateNativeHost,
  writeDebugLogEvent
} from "./nativeClient";

const NATIVE_HOST_UPDATE_ALARM = "native-host-update-check";
const NATIVE_HOST_UPDATE_STORAGE_KEY = "hoverTransPortNativeHostUpdate";
const NATIVE_HOST_UPDATE_CHECK_INTERVAL_MINUTES = 24 * 60;

type NativeHostUpdateStorage = {
  hoverTransPortNativeHostUpdate?: NativeHostUpdateStoredStatus;
};

async function shouldAutoCheckNativeHostUpdate(): Promise<boolean> {
  const stored = (await chrome.storage.local.get("hoverTransPort")) as StoredOptions;
  return normalizeNativeHostUpdateAutoCheck(
    stored.hoverTransPort?.nativeHostUpdateAutoCheck
  );
}

async function ensureNativeHostUpdateAlarm(): Promise<void> {
  const autoCheckEnabled = await shouldAutoCheckNativeHostUpdate();

  if (!autoCheckEnabled) {
    await chrome.alarms.clear(NATIVE_HOST_UPDATE_ALARM);
    return;
  }

  await chrome.alarms.create(NATIVE_HOST_UPDATE_ALARM, {
    periodInMinutes: NATIVE_HOST_UPDATE_CHECK_INTERVAL_MINUTES
  });
}

async function storeNativeHostUpdateStatus(
  status: NativeHostUpdateStoredStatus
): Promise<void> {
  await chrome.storage.local.set({
    [NATIVE_HOST_UPDATE_STORAGE_KEY]: status
  });
  syncNativeHostUpdateBadge(status);
}

function createNativeHostUpdateReconnectFailedStatus(
  previousStatus: NativeHostUpdateStoredStatus | undefined
): NativeHostUpdateStoredStatus {
  return {
    ...createNativeHostUpdateMetadata({
      previousStatus,
      error: "UPDATE_RECONNECT_FAILED"
    }),
    ok: false,
    error: "UPDATE_RECONNECT_FAILED",
    message:
      "Native host update installed, but the extension could not verify the new host. Reload Chrome or the extension, then check again.",
    retryable: true
  };
}

async function refreshNativeHostUpdateStatus(
  requestId: string,
  previousStatus?: NativeHostUpdateStoredStatus
): Promise<NativeHostUpdateStoredStatus> {
  const status = await checkNativeHostUpdateStatus(requestId, previousStatus);
  await storeNativeHostUpdateStatus(status);
  return status;
}

async function maybeRefreshNativeHostUpdateStatus(
  requestId: string
): Promise<NativeHostUpdateStoredStatus | undefined> {
  const stored = (await chrome.storage.local.get(
    NATIVE_HOST_UPDATE_STORAGE_KEY
  )) as NativeHostUpdateStorage;
  const status = stored.hoverTransPortNativeHostUpdate;

  if (
    shouldRefreshNativeHostUpdateStatus(status) &&
    (await shouldAutoCheckNativeHostUpdate())
  ) {
    return refreshNativeHostUpdateStatus(requestId, status);
  }

  syncNativeHostUpdateBadge(status);
  return status;
}

function hasNativeHostUpdateSchedule(
  status: NativeHostUpdateStoredStatus | undefined
): status is NativeHostUpdateStoredStatus {
  return typeof status?.nextCheckAt === "number";
}

function shouldRefreshNativeHostUpdateStatus(
  status: NativeHostUpdateStoredStatus | undefined
): boolean {
  if (!hasNativeHostUpdateSchedule(status)) {
    return true;
  }

  return isNativeHostUpdateRefreshDue(status);
}

function syncNativeHostUpdateBadge(
  status: NativeHostUpdateStoredStatus | undefined
): void {
  const attention = nativeHostUpdateNeedsAttention(status);

  chrome.action.setBadgeText({
    text: attention ? "!" : ""
  });

  if (attention) {
    chrome.action.setBadgeBackgroundColor({
      color: "#b45309"
    });
  }
}

function didNativeHostUpdateAutoCheckChange(
  change: chrome.storage.StorageChange
): boolean {
  const oldOptions = change.oldValue as StoredOptions["hoverTransPort"] | undefined;
  const newOptions = change.newValue as StoredOptions["hoverTransPort"] | undefined;

  return (
    normalizeNativeHostUpdateAutoCheck(
      oldOptions?.nativeHostUpdateAutoCheck
    ) !==
    normalizeNativeHostUpdateAutoCheck(newOptions?.nativeHostUpdateAutoCheck)
  );
}

async function refreshPostNativeHostUpdateStatus(
  requestId: string
): Promise<void> {
  const stored = (await chrome.storage.local.get(
    NATIVE_HOST_UPDATE_STORAGE_KEY
  )) as NativeHostUpdateStorage;
  const previousStatus = stored.hoverTransPortNativeHostUpdate;

  try {
    await checkNativeHost(`${requestId}:host-info`);
    await refreshNativeHostUpdateStatus(`${requestId}:status`, previousStatus);
  } catch {
    await storeNativeHostUpdateStatus(
      createNativeHostUpdateReconnectFailedStatus(previousStatus)
    );
  }
}

function scheduleNativeHostUpdateStatusRefresh(requestId: string): void {
  void maybeRefreshNativeHostUpdateStatus(requestId).catch(() => {
    // Opportunistic update checks must never block extension startup or use.
  });
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    await chrome.storage.local.set({
      hoverTransPort: {
        enabled: DEFAULT_EXTENSION_ENABLED,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        cacheEnabled: DEFAULT_CACHE_ENABLED,
        debugLogging: DEFAULT_DEBUG_LOGGING
      }
    });
  }

  await ensureNativeHostUpdateAlarm();
  scheduleNativeHostUpdateStatusRefresh(`runtime-installed:${Date.now()}`);
});

chrome.runtime.onStartup.addListener(() => {
  void ensureNativeHostUpdateAlarm();
  scheduleNativeHostUpdateStatusRefresh(`runtime-startup:${Date.now()}`);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.hoverTransPort) {
    return;
  }

  if (!didNativeHostUpdateAutoCheckChange(changes.hoverTransPort)) {
    return;
  }

  void ensureNativeHostUpdateAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== NATIVE_HOST_UPDATE_ALARM) {
    return;
  }

  void shouldAutoCheckNativeHostUpdate().then((autoCheckEnabled) => {
    if (!autoCheckEnabled) {
      return;
    }

    return maybeRefreshNativeHostUpdateStatus(
      `${NATIVE_HOST_UPDATE_ALARM}:${Date.now()}`
    );
  });
});

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionRequest,
    _sender,
    sendResponse: (response: ExtensionResponse) => void
  ) => {
    if (message.type === "PING") {
      sendResponse({
        type: "PONG",
        location: "background"
      });
      return;
    }

    if (message.type === "CHECK_NATIVE_HOST") {
      void checkNativeHost(message.requestId).then((status) => {
        sendResponse({
          type: "NATIVE_HOST_STATUS",
          requestId: message.requestId,
          ...status
        });
      });
      return true;
    }

    if (message.type === "GET_STORED_NATIVE_HOST_UPDATE_STATUS") {
      void maybeRefreshNativeHostUpdateStatus(message.requestId)
        .then((status) => {
          sendResponse({
            type: "NATIVE_HOST_UPDATE_STATUS",
            requestId: message.requestId,
            status
          });
        })
        .catch(() => {
          sendResponse({
            type: "NATIVE_HOST_UPDATE_STATUS",
            requestId: message.requestId
          });
        });

      return true;
    }

    if (message.type === "CHECK_NATIVE_HOST_UPDATE") {
      void refreshNativeHostUpdateStatus(message.requestId).then((status) => {
        sendResponse({
          type: "NATIVE_HOST_UPDATE_STATUS",
          requestId: message.requestId,
          status
        });
      });
      return true;
    }

    if (message.type === "UPDATE_NATIVE_HOST") {
      void updateNativeHost(
        message.requestId,
        message.targetTag,
        message.targetVersion
      ).then((result) => {
        sendResponse({
          type: "NATIVE_HOST_UPDATE_RESULT",
          requestId: message.requestId,
          ...result
        });

        void refreshPostNativeHostUpdateStatus(message.requestId);
      });
      return true;
    }

    if (message.type === "CHECK_PROVIDER_STATUS") {
      void checkProviderStatus(message.requestId).then((status) => {
        sendResponse({
          type: "PROVIDER_STATUS",
          requestId: message.requestId,
          ...status
        });
      });
      return true;
    }

    if (message.type === "GET_PROVIDER_MODELS") {
      void getProviderModels(message.requestId, message.provider)
        .then((result) => {
          if (result.ok) {
            sendResponse({
              type: "PROVIDER_MODELS_RESULT",
              requestId: message.requestId,
              ok: true,
              catalog: result.catalog
            });
            return;
          }

          sendResponse({
            type: "PROVIDER_MODELS_RESULT",
            requestId: message.requestId,
            ok: false,
            provider: result.provider,
            error: result.error,
            message: result.message,
            retryable: result.retryable,
            fallbackCatalog: result.fallbackCatalog
          });
        })
        .catch((error: unknown) => {
          const providerId = resolveProviderForModel(message.provider);
          sendResponse({
            type: "PROVIDER_MODELS_RESULT",
            requestId: message.requestId,
            ok: false,
            provider: providerId,
            error: "UNKNOWN_ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
            retryable: true,
            fallbackCatalog: getFallbackModelCatalog(providerId)
          });
        });

      return true;
    }

    if (message.type === "CLEAR_TRANSLATION_CACHE") {
      void clearTranslationCache(message.requestId)
        .then((result) => {
          if (result.ok) {
            sendResponse({
              type: "CACHE_CLEAR_RESULT",
              requestId: message.requestId,
              ok: true,
              deletedRows: result.deletedRows
            });
            return;
          }

          sendResponse({
            type: "CACHE_CLEAR_RESULT",
            requestId: message.requestId,
            ok: false,
            error: result.error,
            message: result.message,
            retryable: result.retryable
          });
        })
        .catch((error: unknown) => {
          sendResponse({
            type: "CACHE_CLEAR_RESULT",
            requestId: message.requestId,
            ok: false,
            error: "UNKNOWN_ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
            retryable: true
          });
        });

      return true;
    }

    if (message.type === "GET_DEBUG_LOG_INFO") {
      void getDebugLogInfo(message.requestId)
        .then((result) => {
          if (result.ok) {
            sendResponse({
              type: "DEBUG_LOG_INFO_RESULT",
              requestId: message.requestId,
              ok: true,
              logPath: result.logPath,
              exists: result.exists,
              sizeBytes: result.sizeBytes
            });
            return;
          }

          sendResponse({
            type: "DEBUG_LOG_INFO_RESULT",
            requestId: message.requestId,
            ok: false,
            error: result.error,
            message: result.message,
            retryable: result.retryable
          });
        })
        .catch((error: unknown) => {
          sendResponse({
            type: "DEBUG_LOG_INFO_RESULT",
            requestId: message.requestId,
            ok: false,
            error: "UNKNOWN_ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
            retryable: true
          });
        });

      return true;
    }

    if (message.type === "CLEAR_DEBUG_LOG") {
      void clearDebugLog(message.requestId)
        .then((result) => {
          if (result.ok) {
            sendResponse({
              type: "DEBUG_LOG_CLEAR_RESULT",
              requestId: message.requestId,
              ok: true,
              logPath: result.logPath,
              exists: result.exists,
              sizeBytes: result.sizeBytes
            });
            return;
          }

          sendResponse({
            type: "DEBUG_LOG_CLEAR_RESULT",
            requestId: message.requestId,
            ok: false,
            error: result.error,
            message: result.message,
            retryable: result.retryable
          });
        })
        .catch((error: unknown) => {
          sendResponse({
            type: "DEBUG_LOG_CLEAR_RESULT",
            requestId: message.requestId,
            ok: false,
            error: "UNKNOWN_ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
            retryable: true
          });
        });

      return true;
    }

    if (message.type === "GET_DEBUG_LOG_CONTENT") {
      void getDebugLogContent(message.requestId, {
        maxBytes: message.maxBytes,
        maxLines: message.maxLines
      })
        .then((result) => {
          if (result.ok) {
            sendResponse({
              type: "DEBUG_LOG_CONTENT_RESULT",
              requestId: message.requestId,
              ok: true,
              logPath: result.logPath,
              exists: result.exists,
              sizeBytes: result.sizeBytes,
              content: result.content,
              truncated: result.truncated
            });
            return;
          }

          sendResponse({
            type: "DEBUG_LOG_CONTENT_RESULT",
            requestId: message.requestId,
            ok: false,
            error: result.error,
            message: result.message,
            retryable: result.retryable
          });
        })
        .catch((error: unknown) => {
          sendResponse({
            type: "DEBUG_LOG_CONTENT_RESULT",
            requestId: message.requestId,
            ok: false,
            error: "UNKNOWN_ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
            retryable: true
          });
        });

      return true;
    }

    if (message.type === "WRITE_DEBUG_LOG_EVENT") {
      void writeDebugLogEvent(
        message.requestId,
        message.event,
        message.fields
      )
        .then((result) => {
          if (result.ok) {
            sendResponse({
              type: "DEBUG_LOG_WRITE_RESULT",
              requestId: message.requestId,
              ok: true,
              written: result.written
            });
            return;
          }

          sendResponse({
            type: "DEBUG_LOG_WRITE_RESULT",
            requestId: message.requestId,
            ok: false,
            error: result.error,
            message: result.message,
            retryable: result.retryable
          });
        })
        .catch((error: unknown) => {
          sendResponse({
            type: "DEBUG_LOG_WRITE_RESULT",
            requestId: message.requestId,
            ok: false,
            error: "UNKNOWN_ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
            retryable: true
          });
        });

      return true;
    }

    if (message.type === "TRANSLATE_CURRENT_TARGET") {
      scheduleNativeHostUpdateStatusRefresh(
        `${message.requestId}:native-host-update`
      );
      void translateWithNativeHost(message.requestId, message.target).then(
        (result) => {
          sendResponse({
            type: "TRANSLATE_RESULT",
            requestId: message.requestId,
            ...result
          });
        }
      );
      return true;
    }

    sendResponse({
      type: "ERROR",
      message: "Unsupported message type."
    });
  }
);
