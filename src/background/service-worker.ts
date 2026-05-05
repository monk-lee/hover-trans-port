import type { ExtensionRequest, ExtensionResponse } from "../shared/messages";
import {
  DEFAULT_CACHE_ENABLED,
  DEFAULT_DEBUG_LOGGING,
  DEFAULT_EXTENSION_ENABLED,
  DEFAULT_TIMEOUT_MS
} from "../shared/options";
import {
  checkNativeHost,
  checkProviderStatus,
  clearDebugLog,
  clearTranslationCache,
  getDebugLogContent,
  getDebugLogInfo,
  translateWithNativeHost,
  writeDebugLogEvent
} from "./nativeClient";

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== chrome.runtime.OnInstalledReason.INSTALL) {
    return;
  }

  await chrome.storage.local.set({
    hoverTransPort: {
      enabled: DEFAULT_EXTENSION_ENABLED,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      cacheEnabled: DEFAULT_CACHE_ENABLED,
      debugLogging: DEFAULT_DEBUG_LOGGING
    }
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
