import { createTranslationCacheKey } from "./cache/cacheKey.mjs";
import { createTranslationCache } from "./cache/sqliteCache.mjs";
import { createDebugLogger } from "./debugLogger.mjs";
import {
  NATIVE_BRIDGE_VERSION,
  createNativeHostInfo
} from "./hostMetadata.mjs";
import { CodexProvider } from "./providers/CodexProvider.mjs";
import { createDefaultProviderRegistry } from "./providers/providerRegistry.mjs";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidMessage(message = "Native message must be a JSON object.") {
  return {
    type: "ERROR",
    ok: false,
    error: "INVALID_MESSAGE",
    message,
    retryable: false
  };
}

function unsupportedMessage(requestId) {
  return {
    type: "ERROR",
    requestId,
    ok: false,
    error: "UNSUPPORTED_MESSAGE",
    message: "Unsupported native message type.",
    retryable: false
  };
}

let defaultCache;
let defaultDebugLogger;

function getDefaultCache() {
  defaultCache ??= createTranslationCache();
  return defaultCache;
}

function getDefaultDebugLogger() {
  defaultDebugLogger ??= createDebugLogger();
  return defaultDebugLogger;
}

function normalizeProviderError(error) {
  const code =
    error && typeof error.code === "string"
      ? error.code
      : "PROVIDER_UNAVAILABLE";

  return {
    error: code,
    message: error instanceof Error ? error.message : String(error),
    retryable:
      typeof error?.retryable === "boolean" ? error.retryable : true,
    elapsedMs:
      typeof error?.elapsedMs === "number" ? Math.round(error.elapsedMs) : undefined
  };
}

function summarizeLogMessage(message) {
  return String(message ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function summarizeProviderErrorForLog(errorCode, message) {
  switch (errorCode) {
    case "PROVIDER_NOT_FOUND":
      return "Codex binary was not found.";
    case "PROVIDER_TIMEOUT":
      return "Provider process timed out.";
    case "PROVIDER_EXIT_NONZERO":
      return "Provider exited with a non-zero status.";
    case "PROVIDER_OUTPUT_PARSE_FAILED":
      return "Provider output could not be parsed.";
    default:
      return summarizeLogMessage(message);
  }
}

function debugLog(enabled, logger, event, fields = {}) {
  if (enabled) {
    logger.write(event, fields);
    process.stderr.write(`native-host debug: ${event}\n`);
  }
}

function isRequestWithId(message, type) {
  return message.type === type && typeof message.requestId === "string";
}

function isDebugLogContentRequest(message) {
  return (
    isRequestWithId(message, "GET_DEBUG_LOG_CONTENT") &&
    (message.maxBytes === undefined || typeof message.maxBytes === "number") &&
    (message.maxLines === undefined || typeof message.maxLines === "number")
  );
}

function isDebugLogFieldValue(value) {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
}

function sanitizeDebugLogFields(fields) {
  if (!isObject(fields)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(fields)
      .filter(
        ([key, value]) =>
          typeof key === "string" &&
          key.length > 0 &&
          key.length <= 80 &&
          isDebugLogFieldValue(value)
      )
      .slice(0, 50)
      .map(([key, value]) => [
        key,
        typeof value === "string" ? summarizeLogMessage(value) : value
      ])
  );
}

function isDebugLogWriteRequest(message) {
  return (
    isRequestWithId(message, "WRITE_DEBUG_LOG") &&
    typeof message.event === "string" &&
    message.event.trim().length > 0 &&
    message.event.length <= 120 &&
    (message.fields === undefined || isObject(message.fields))
  );
}

function isClearCacheRequest(message) {
  return isRequestWithId(message, "CLEAR_TRANSLATION_CACHE");
}

function isProviderModelsRequest(message) {
  return (
    isRequestWithId(message, "PROVIDER_MODELS") &&
    (message.provider === undefined || typeof message.provider === "string")
  );
}

function isTranslateRequest(message) {
  return (
    message.type === "TRANSLATE" &&
    typeof message.requestId === "string" &&
    typeof message.text === "string" &&
    (message.model === undefined || typeof message.model === "string") &&
    (message.timeoutMs === undefined || typeof message.timeoutMs === "number") &&
    (message.cacheEnabled === undefined ||
      typeof message.cacheEnabled === "boolean") &&
    (message.debugLogging === undefined ||
      typeof message.debugLogging === "boolean") &&
    typeof message.targetLang === "string"
  );
}

export async function handleNativeRequest(message, dependencies = {}) {
  if (!isObject(message)) {
    return invalidMessage();
  }

  if (message.type === "HOST_INFO") {
    if (!isRequestWithId(message, "HOST_INFO")) {
      return {
        type: "HOST_INFO_RESULT",
        requestId:
          typeof message.requestId === "string" ? message.requestId : undefined,
        ok: false,
        error: "INVALID_MESSAGE",
        message: "HOST_INFO message is missing required fields.",
        retryable: false
      };
    }

    return {
      type: "HOST_INFO_RESULT",
      requestId: message.requestId,
      ok: true,
      ...createNativeHostInfo()
    };
  }

  if (message.type === "PING") {
    return {
      type: "PONG",
      requestId: message.requestId,
      ok: true,
      bridgeVersion: NATIVE_BRIDGE_VERSION
    };
  }

  const provider = dependencies.provider ?? new CodexProvider();
  const providerRegistry =
    dependencies.providerRegistry ?? createDefaultProviderRegistry({ provider });
  const cache = dependencies.cache ?? getDefaultCache();
  const debugLogger = dependencies.debugLogger ?? getDefaultDebugLogger();

  if (message.type === "PROVIDER_STATUS") {
    const providers = await providerRegistry.getStatusEntries(message.provider);
    return {
      type: "PROVIDER_STATUS_RESULT",
      requestId: message.requestId,
      ok: true,
      providers
    };
  }

  if (message.type === "PROVIDER_MODELS") {
    if (!isProviderModelsRequest(message)) {
      return {
        type: "PROVIDER_MODELS_RESULT",
        requestId: message.requestId,
        ok: false,
        provider: "codex",
        error: "INVALID_MESSAGE",
        message: "PROVIDER_MODELS message is missing required fields.",
        retryable: false
      };
    }

    const catalog = await providerRegistry.modelCatalog(message.provider);
    return {
      type: "PROVIDER_MODELS_RESULT",
      requestId: message.requestId,
      ok: true,
      catalog
    };
  }

  if (message.type === "CLEAR_TRANSLATION_CACHE") {
    if (!isClearCacheRequest(message)) {
      return {
        type: "CACHE_CLEAR_RESULT",
        requestId: message.requestId,
        ok: false,
        error: "INVALID_MESSAGE",
        message: "CLEAR_TRANSLATION_CACHE message is missing required fields.",
        retryable: false
      };
    }

    try {
      const result = cache.clear();
      return {
        type: "CACHE_CLEAR_RESULT",
        requestId: message.requestId,
        ok: true,
        deletedRows: result.deletedRows
      };
    } catch (error) {
      return {
        type: "CACHE_CLEAR_RESULT",
        requestId: message.requestId,
        ok: false,
        error: "CACHE_ERROR",
        message: error instanceof Error ? error.message : String(error),
        retryable: true
      };
    }
  }

  if (message.type === "GET_DEBUG_LOG_INFO") {
    if (!isRequestWithId(message, "GET_DEBUG_LOG_INFO")) {
      return {
        type: "DEBUG_LOG_INFO_RESULT",
        requestId: message.requestId,
        ok: false,
        error: "INVALID_MESSAGE",
        message: "GET_DEBUG_LOG_INFO message is missing required fields.",
        retryable: false
      };
    }

    try {
      const info = debugLogger.info();
      return {
        type: "DEBUG_LOG_INFO_RESULT",
        requestId: message.requestId,
        ok: true,
        ...info
      };
    } catch (error) {
      return {
        type: "DEBUG_LOG_INFO_RESULT",
        requestId: message.requestId,
        ok: false,
        error: "DEBUG_LOG_ERROR",
        message: error instanceof Error ? error.message : String(error),
        retryable: true
      };
    }
  }

  if (message.type === "CLEAR_DEBUG_LOG") {
    if (!isRequestWithId(message, "CLEAR_DEBUG_LOG")) {
      return {
        type: "DEBUG_LOG_CLEAR_RESULT",
        requestId: message.requestId,
        ok: false,
        error: "INVALID_MESSAGE",
        message: "CLEAR_DEBUG_LOG message is missing required fields.",
        retryable: false
      };
    }

    try {
      const info = debugLogger.clear();
      return {
        type: "DEBUG_LOG_CLEAR_RESULT",
        requestId: message.requestId,
        ok: true,
        ...info
      };
    } catch (error) {
      return {
        type: "DEBUG_LOG_CLEAR_RESULT",
        requestId: message.requestId,
        ok: false,
        error: "DEBUG_LOG_ERROR",
        message: error instanceof Error ? error.message : String(error),
        retryable: true
      };
    }
  }

  if (message.type === "GET_DEBUG_LOG_CONTENT") {
    if (!isDebugLogContentRequest(message)) {
      return {
        type: "DEBUG_LOG_CONTENT_RESULT",
        requestId: message.requestId,
        ok: false,
        error: "INVALID_MESSAGE",
        message: "GET_DEBUG_LOG_CONTENT message is missing required fields.",
        retryable: false
      };
    }

    try {
      const result = debugLogger.readTail({
        maxBytes: message.maxBytes,
        maxLines: message.maxLines
      });
      return {
        type: "DEBUG_LOG_CONTENT_RESULT",
        requestId: message.requestId,
        ok: true,
        ...result
      };
    } catch (error) {
      return {
        type: "DEBUG_LOG_CONTENT_RESULT",
        requestId: message.requestId,
        ok: false,
        error: "DEBUG_LOG_ERROR",
        message: error instanceof Error ? error.message : String(error),
        retryable: true
      };
    }
  }

  if (message.type === "WRITE_DEBUG_LOG") {
    if (!isDebugLogWriteRequest(message)) {
      return {
        type: "DEBUG_LOG_WRITE_RESULT",
        requestId: message.requestId,
        ok: false,
        error: "INVALID_MESSAGE",
        message: "WRITE_DEBUG_LOG message is missing required fields.",
        retryable: false
      };
    }

    try {
      const written = debugLogger.write(message.event.trim(), {
        ...sanitizeDebugLogFields(message.fields),
        requestId: message.requestId
      });

      if (written) {
        process.stderr.write(`native-host debug: ${message.event.trim()}\n`);
      }

      return {
        type: "DEBUG_LOG_WRITE_RESULT",
        requestId: message.requestId,
        ok: true,
        written
      };
    } catch (error) {
      return {
        type: "DEBUG_LOG_WRITE_RESULT",
        requestId: message.requestId,
        ok: false,
        error: "DEBUG_LOG_ERROR",
        message: error instanceof Error ? error.message : String(error),
        retryable: true
      };
    }
  }

  if (message.type === "TRANSLATE") {
    const startedAt = Date.now();

    if (!isTranslateRequest(message)) {
      return {
        type: "TRANSLATE_RESULT",
        requestId: message.requestId,
        ok: false,
        provider: "codex",
        error: "INVALID_MESSAGE",
        message: "TRANSLATE message is missing required fields.",
        retryable: false,
        elapsedMs: Date.now() - startedAt
      };
    }

    const resolvedProvider = providerRegistry.resolveProvider(message.provider);

    if (!resolvedProvider.ok) {
      return {
        type: "TRANSLATE_RESULT",
        requestId: message.requestId,
        ok: false,
        provider: resolvedProvider.providerId,
        error: "PROVIDER_UNAVAILABLE",
        message: `${resolvedProvider.status.label} is not available in Phase 9.`,
        retryable: false,
        elapsedMs: Date.now() - startedAt
      };
    }

    const { selectedProvider } = resolvedProvider;
    const selectedModel = message.model || selectedProvider.defaultModel;

    try {
      const cacheEnabled = message.cacheEnabled !== false;
      const debugLogging = message.debugLogging === true;
      const baseLogFields = {
        requestId: message.requestId,
        provider: selectedProvider.id,
        model: selectedModel,
        targetLang: message.targetLang,
        timeoutMs: message.timeoutMs,
        cacheEnabled,
        textLength: message.text.length
      };
      debugLog(debugLogging, debugLogger, "translation.start", baseLogFields);

      const cacheKey = createTranslationCacheKey({
        provider: selectedProvider.id,
        model: selectedModel,
        targetLang: message.targetLang,
        text: message.text
      });

      if (cacheEnabled) {
        try {
          const cachedResult = cache.lookup(cacheKey);
          if (cachedResult) {
            const elapsedMs = Date.now() - startedAt;
            debugLog(debugLogging, debugLogger, "cache.hit", {
              requestId: message.requestId,
              elapsedMs
            });
            debugLog(debugLogging, debugLogger, "translation.success", {
              requestId: message.requestId,
              cached: true,
              elapsedMs
            });
            return {
              type: "TRANSLATE_RESULT",
              requestId: message.requestId,
              ok: true,
              provider: selectedProvider.id,
              translatedText: cachedResult.translatedText,
              cached: true,
              elapsedMs
            };
          }
          debugLog(debugLogging, debugLogger, "cache.miss", {
            requestId: message.requestId
          });
        } catch (error) {
          debugLog(debugLogging, debugLogger, "cache.lookup_failed", {
            requestId: message.requestId,
            message: summarizeLogMessage(error instanceof Error ? error.message : error)
          });
        }
      } else {
        debugLog(debugLogging, debugLogger, "cache.disabled", {
          requestId: message.requestId
        });
      }

      debugLog(debugLogging, debugLogger, "provider.start", {
        requestId: message.requestId,
        provider: selectedProvider.id
      });
      const result = await selectedProvider.translate({
        text: message.text,
        model: selectedModel,
        sourceLang: message.sourceLang ?? "auto",
        targetLang: message.targetLang,
        timeoutMs: message.timeoutMs
      });

      if (cacheEnabled) {
        try {
          cache.write(cacheKey, {
            translatedText: result.translatedText
          });
          debugLog(debugLogging, debugLogger, "cache.write", {
            requestId: message.requestId
          });
        } catch (error) {
          debugLog(debugLogging, debugLogger, "cache.write_failed", {
            requestId: message.requestId,
            message: summarizeLogMessage(error instanceof Error ? error.message : error)
          });
        }
      }

      const elapsedMs = Math.round(result.elapsedMs ?? Date.now() - startedAt);
      debugLog(debugLogging, debugLogger, "translation.success", {
        requestId: message.requestId,
        cached: false,
        elapsedMs
      });

      return {
        type: "TRANSLATE_RESULT",
        requestId: message.requestId,
        ok: true,
        provider: selectedProvider.id,
        translatedText: result.translatedText,
        cached: false,
        elapsedMs
      };
    } catch (error) {
      const normalized = normalizeProviderError(error);
      debugLog(message.debugLogging === true, debugLogger, "translation.error", {
        requestId: message.requestId,
        error: normalized.error,
        retryable: normalized.retryable,
        elapsedMs: normalized.elapsedMs ?? Date.now() - startedAt,
        message: summarizeProviderErrorForLog(
          normalized.error,
          normalized.message
        )
      });
      return {
        type: "TRANSLATE_RESULT",
        requestId: message.requestId,
        ok: false,
        provider: selectedProvider.id,
        ...normalized,
        elapsedMs: normalized.elapsedMs ?? Date.now() - startedAt
      };
    }
  }

  return unsupportedMessage(message.requestId);
}
