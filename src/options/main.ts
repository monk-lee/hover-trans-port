import "./options.css";
import type { ExtensionRequest, ExtensionResponse } from "../shared/messages";
import {
  getDefaultModelForProvider,
  getProviderLabel,
  resolveProviderForModel
} from "../shared/providers";
import {
  COMMON_TARGET_LANGUAGES,
  CUSTOM_TARGET_LANG_VALUE,
  DEFAULT_CACHE_ENABLED,
  DEFAULT_CODEX_MODEL,
  DEFAULT_DEBUG_LOGGING,
  DEFAULT_EXTENSION_ENABLED,
  DEFAULT_PROVIDER,
  DEFAULT_TRIGGER_HOTKEY,
  DEFAULT_TIMEOUT_MS,
  getBrowserTargetLang,
  getModelForProvider,
  normalizeCacheEnabled,
  normalizeDebugLogging,
  normalizeEnabled,
  normalizeProvider,
  normalizeProviderModel,
  normalizeTargetLang,
  normalizeTriggerHotkey,
  normalizeTimeoutMs,
  type CommonTargetLanguage,
  type StoredOptions,
  type TriggerHotkey
} from "../shared/options";
import {
  createModifierChordHotkeyFromCodes,
  createComboHotkeyFromEvent,
  createModifierHotkeyFromCode,
  formatTriggerHotkey,
  isModifierTriggerCode,
  type ModifierTriggerCode,
  validateTriggerHotkey
} from "../shared/hotkeys";

const enabledInput = document.querySelector<HTMLInputElement>("#enabled");
const targetLanguageInput =
  document.querySelector<HTMLSelectElement>("#target-language");
const targetLanguageCustomRow = document.querySelector<HTMLLabelElement>(
  "#target-language-custom-row"
);
const targetLanguageCustomInput = document.querySelector<HTMLInputElement>(
  "#target-language-custom"
);
const triggerHotkeyDisplay =
  document.querySelector<HTMLElement>("#trigger-hotkey-display");
const triggerHotkeyRecordButton =
  document.querySelector<HTMLButtonElement>("#trigger-hotkey-record");
const triggerHotkeyResetButton =
  document.querySelector<HTMLButtonElement>("#trigger-hotkey-reset");
const triggerHotkeyStatus =
  document.querySelector<HTMLParagraphElement>("#trigger-hotkey-status");
const saveState = document.querySelector<HTMLParagraphElement>("#save-state");
const nativeHostPingButton =
  document.querySelector<HTMLButtonElement>("#native-host-ping");
const nativeHostStatus =
  document.querySelector<HTMLParagraphElement>("#native-host-status");
const providerInput = document.querySelector<HTMLSelectElement>("#provider");
const providerStatusCheckButton =
  document.querySelector<HTMLButtonElement>("#provider-status-check");
const providerModelResetButton =
  document.querySelector<HTMLButtonElement>("#provider-model-reset");
const providerModelInput =
  document.querySelector<HTMLInputElement>("#provider-model");
const providerStatus =
  document.querySelector<HTMLParagraphElement>("#provider-status");
const timeoutInput = document.querySelector<HTMLInputElement>("#timeout-ms");
const cacheEnabledInput =
  document.querySelector<HTMLInputElement>("#cache-enabled");
const debugLoggingInput =
  document.querySelector<HTMLInputElement>("#debug-logging");
const debugLogPath = document.querySelector<HTMLElement>("#debug-log-path");
const debugLogStatus =
  document.querySelector<HTMLParagraphElement>("#debug-log-status");
const debugLogView = document.querySelector<HTMLElement>("#debug-log-view");
const debugLogContent =
  document.querySelector<HTMLPreElement>("#debug-log-content");
const debugLogRefreshButton =
  document.querySelector<HTMLButtonElement>("#debug-log-refresh");
const debugLogClearButton =
  document.querySelector<HTMLButtonElement>("#debug-log-clear");
const cacheClearButton =
  document.querySelector<HTMLButtonElement>("#cache-clear");
const cacheStatus =
  document.querySelector<HTMLParagraphElement>("#cache-status");
const DEBUG_LOG_MAX_BYTES = 32 * 1024;
const DEBUG_LOG_MAX_LINES = 200;
let currentTriggerHotkey: TriggerHotkey = DEFAULT_TRIGGER_HOTKEY;
let isRecordingTriggerHotkey = false;
const pendingModifierCodes = new Set<ModifierTriggerCode>();

function setSaveState(message: string) {
  if (saveState) {
    saveState.textContent = message;
  }
}

function setTriggerHotkeyStatus(message: string) {
  if (triggerHotkeyStatus) {
    triggerHotkeyStatus.textContent = message;
  }
}

function setTriggerHotkeyInput(hotkey: TriggerHotkey) {
  currentTriggerHotkey = hotkey;

  if (triggerHotkeyDisplay) {
    triggerHotkeyDisplay.textContent = formatTriggerHotkey(hotkey);
  }
}

function setTriggerHotkeyRecordingState(recording: boolean) {
  isRecordingTriggerHotkey = recording;

  if (triggerHotkeyRecordButton) {
    triggerHotkeyRecordButton.textContent = recording ? "Cancel" : "Record";
    triggerHotkeyRecordButton.setAttribute(
      "aria-pressed",
      recording ? "true" : "false"
    );
  }
}

function setNativeHostStatus(message: string) {
  if (nativeHostStatus) {
    nativeHostStatus.textContent = message;
  }
}

function setProviderStatus(message: string) {
  if (providerStatus) {
    providerStatus.textContent = message;
  }
}

function setCacheStatus(message: string) {
  if (cacheStatus) {
    cacheStatus.textContent = message;
  }
}

function setDebugLogPath(message: string) {
  if (debugLogPath) {
    debugLogPath.textContent = message;
  }
}

function setDebugLogStatus(message: string) {
  if (debugLogStatus) {
    debugLogStatus.textContent = message;
  }
}

function setDebugLogContent(message: string) {
  if (debugLogContent) {
    debugLogContent.textContent = message;
  }
}

function isDebugLoggingEnabled(): boolean {
  return debugLoggingInput?.checked === true;
}

function setDebugLogViewVisible(visible: boolean) {
  if (debugLogView) {
    debugLogView.hidden = !visible;
  }

  if (debugLogRefreshButton) {
    debugLogRefreshButton.hidden = !visible;
  }

  if (debugLogClearButton) {
    debugLogClearButton.hidden = !visible;
  }
}

function createRequestId(): string {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()}`;
}

function timeoutMsToSeconds(timeoutMs: number | undefined): number {
  return Math.round(normalizeTimeoutMs(timeoutMs) / 1000);
}

function timeoutSecondsInputToMs(seconds: string | undefined): number {
  const trimmed = seconds?.trim();

  if (!trimmed) {
    return DEFAULT_TIMEOUT_MS;
  }

  return normalizeTimeoutMs(Number(trimmed) * 1000);
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

function getBrowserDefaultTargetLang(): string {
  return getBrowserTargetLang(getBrowserLocaleCandidates());
}

function isCommonTargetLanguage(
  targetLang: string
): targetLang is CommonTargetLanguage {
  return COMMON_TARGET_LANGUAGES.includes(targetLang as CommonTargetLanguage);
}

function populateTargetLanguageOptions() {
  if (!targetLanguageInput || targetLanguageInput.options.length > 0) {
    return;
  }

  for (const language of COMMON_TARGET_LANGUAGES) {
    const option = document.createElement("option");
    option.value = language;
    option.textContent = language;
    targetLanguageInput.append(option);
  }

  const customOption = document.createElement("option");
  customOption.value = CUSTOM_TARGET_LANG_VALUE;
  customOption.textContent = "Custom...";
  targetLanguageInput.append(customOption);
}

function updateTargetLanguageCustomVisibility() {
  const customSelected = targetLanguageInput?.value === CUSTOM_TARGET_LANG_VALUE;

  if (targetLanguageCustomRow) {
    targetLanguageCustomRow.hidden = !customSelected;
  }
}

function setTargetLanguageInputs(targetLang: string) {
  populateTargetLanguageOptions();

  if (!targetLanguageInput) {
    return;
  }

  if (isCommonTargetLanguage(targetLang)) {
    targetLanguageInput.value = targetLang;

    if (targetLanguageCustomInput) {
      targetLanguageCustomInput.value = "";
    }
  } else {
    targetLanguageInput.value = CUSTOM_TARGET_LANG_VALUE;

    if (targetLanguageCustomInput) {
      targetLanguageCustomInput.value = targetLang;
    }
  }

  updateTargetLanguageCustomVisibility();
}

function getSelectedTargetLangForSave(): string {
  const browserDefaultTargetLang = getBrowserDefaultTargetLang();

  if (targetLanguageInput?.value === CUSTOM_TARGET_LANG_VALUE) {
    return normalizeTargetLang(
      targetLanguageCustomInput?.value,
      browserDefaultTargetLang
    );
  }

  return normalizeTargetLang(targetLanguageInput?.value, browserDefaultTargetLang);
}

function stopTriggerHotkeyRecording(message = "") {
  window.removeEventListener("keydown", handleTriggerHotkeyRecordKeyDown, true);
  window.removeEventListener("keyup", handleTriggerHotkeyRecordKeyUp, true);
  pendingModifierCodes.clear();
  setTriggerHotkeyRecordingState(false);
  setTriggerHotkeyStatus(message);
}

function getPendingModifierHotkey(): TriggerHotkey | null {
  const modifierChordHotkey =
    createModifierChordHotkeyFromCodes(pendingModifierCodes);

  if (modifierChordHotkey) {
    return modifierChordHotkey;
  }

  const [modifierCode] = pendingModifierCodes;

  return modifierCode ? createModifierHotkeyFromCode(modifierCode) : null;
}

async function acceptRecordedTriggerHotkey(hotkey: TriggerHotkey) {
  const validationMessage = validateTriggerHotkey(hotkey);

  if (validationMessage) {
    pendingModifierCodes.clear();
    setTriggerHotkeyStatus(validationMessage);
    return;
  }

  setTriggerHotkeyInput(hotkey);
  setTriggerHotkeyStatus("Saving...");

  try {
    await saveOptions();
    stopTriggerHotkeyRecording("Saved.");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    setSaveState(message);
    stopTriggerHotkeyRecording(message);
  }
}

function handleTriggerHotkeyRecordKeyDown(event: KeyboardEvent) {
  if (!isRecordingTriggerHotkey) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (event.repeat) {
    return;
  }

  if (event.code === "Escape") {
    stopTriggerHotkeyRecording("Canceled.");
    return;
  }

  const comboHotkey = createComboHotkeyFromEvent(event);

  if (comboHotkey) {
    acceptRecordedTriggerHotkey(comboHotkey).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      setTriggerHotkeyStatus(message);
    });
    return;
  }

  const modifierHotkey = createModifierHotkeyFromCode(event.code);

  if (modifierHotkey) {
    pendingModifierCodes.add(modifierHotkey.code);
    const pendingHotkey = getPendingModifierHotkey() ?? modifierHotkey;
    setTriggerHotkeyStatus(`${formatTriggerHotkey(pendingHotkey)} selected.`);
    return;
  }

  setTriggerHotkeyStatus("Use a modifier alone or a modifier shortcut.");
}

function handleTriggerHotkeyRecordKeyUp(event: KeyboardEvent) {
  if (!isRecordingTriggerHotkey) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (
    !isModifierTriggerCode(event.code) ||
    !pendingModifierCodes.has(event.code)
  ) {
    return;
  }

  const pendingHotkey = getPendingModifierHotkey();

  if (!pendingHotkey) {
    return;
  }

  acceptRecordedTriggerHotkey(pendingHotkey).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    setTriggerHotkeyStatus(message);
  });
}

function startTriggerHotkeyRecording() {
  pendingModifierCodes.clear();
  setTriggerHotkeyRecordingState(true);
  setTriggerHotkeyStatus("Recording...");
  window.addEventListener("keydown", handleTriggerHotkeyRecordKeyDown, true);
  window.addEventListener("keyup", handleTriggerHotkeyRecordKeyUp, true);
}

function formatByteSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  return `${(sizeBytes / 1024).toFixed(1)} KB`;
}

function formatDebugLogContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "No debug log entries.";
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const timestamp =
          typeof entry.timestamp === "string" ? entry.timestamp : "";
        const event = typeof entry.event === "string" ? entry.event : "event";
        const fields = Object.entries(entry)
          .filter(([key]) => key !== "timestamp" && key !== "event")
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join(" ");
        return [timestamp, event, fields].filter(Boolean).join(" ");
      } catch {
        return line;
      }
    })
    .join("\n");
}

async function loadOptions() {
  const options = (await chrome.storage.local.get(
    "hoverTransPort"
  )) as StoredOptions;

  if (enabledInput) {
    enabledInput.checked = normalizeEnabled(options.hoverTransPort?.enabled);
  }

  const selectedTargetLang = normalizeTargetLang(
    options.hoverTransPort?.targetLang,
    getBrowserDefaultTargetLang()
  );
  setTargetLanguageInputs(selectedTargetLang);
  setTriggerHotkeyInput(
    normalizeTriggerHotkey(options.hoverTransPort?.triggerHotkey)
  );

  const selectedProvider = normalizeProvider(options.hoverTransPort?.provider);
  const modelProvider = resolveProviderForModel(selectedProvider);

  if (providerInput) {
    providerInput.value =
      selectedProvider === "auto" ? DEFAULT_PROVIDER : selectedProvider;
  }

  if (providerModelInput) {
    providerModelInput.value = getModelForProvider(
      options.hoverTransPort,
      selectedProvider
    );
    providerModelInput.placeholder =
      getDefaultModelForProvider(modelProvider) || DEFAULT_CODEX_MODEL;
  }

  if (timeoutInput) {
    timeoutInput.value = String(
      timeoutMsToSeconds(options.hoverTransPort?.timeoutMs)
    );
    timeoutInput.placeholder = String(DEFAULT_TIMEOUT_MS / 1000);
  }

  if (cacheEnabledInput) {
    cacheEnabledInput.checked = normalizeCacheEnabled(
      options.hoverTransPort?.cacheEnabled
    );
  }

  if (debugLoggingInput) {
    debugLoggingInput.checked = normalizeDebugLogging(
      options.hoverTransPort?.debugLogging
    );
  }
}

async function loadDebugLogInfo() {
  const requestId = createRequestId();
  setDebugLogStatus("Checking...");

  const response = await chrome.runtime.sendMessage<
    ExtensionRequest,
    ExtensionResponse
  >({
    type: "GET_DEBUG_LOG_INFO",
    requestId
  });

  if (
    response?.type !== "DEBUG_LOG_INFO_RESULT" ||
    response.requestId !== requestId
  ) {
    setDebugLogPath("Unavailable");
    setDebugLogStatus("Debug log info returned an invalid response.");
    return;
  }

  if (!response.ok) {
    setDebugLogPath("Unavailable");
    setDebugLogStatus(response.message);
    return;
  }

  setDebugLogPath(response.logPath);
  setDebugLogStatus(
    response.exists
      ? `Current size ${formatByteSize(response.sizeBytes)}.`
      : "Log file has not been created yet."
  );
}

async function loadDebugLogContent() {
  setDebugLogViewVisible(isDebugLoggingEnabled());

  if (!isDebugLoggingEnabled()) {
    setDebugLogContent("");
    return;
  }

  const requestId = createRequestId();
  setDebugLogContent("Loading...");

  const response = await chrome.runtime.sendMessage<
    ExtensionRequest,
    ExtensionResponse
  >({
    type: "GET_DEBUG_LOG_CONTENT",
    requestId,
    maxBytes: DEBUG_LOG_MAX_BYTES,
    maxLines: DEBUG_LOG_MAX_LINES
  });

  if (
    response?.type !== "DEBUG_LOG_CONTENT_RESULT" ||
    response.requestId !== requestId
  ) {
    setDebugLogContent("Debug log content returned an invalid response.");
    return;
  }

  if (!response.ok) {
    setDebugLogContent(response.message);
    return;
  }

  const prefix = response.truncated ? "[Showing recent log entries]\n" : "";
  setDebugLogContent(`${prefix}${formatDebugLogContent(response.content)}`);
}

async function saveOptions() {
  const current = (await chrome.storage.local.get(
    "hoverTransPort"
  )) as StoredOptions;
  const selectedProvider = normalizeProvider(providerInput?.value);
  const modelProvider = resolveProviderForModel(selectedProvider);
  const selectedModel = normalizeProviderModel(
    modelProvider,
    providerModelInput?.value
  );
  const modelsByProvider = {
    ...current.hoverTransPort?.modelsByProvider,
    [modelProvider]: selectedModel
  };

  await chrome.storage.local.set({
    hoverTransPort: {
      ...current.hoverTransPort,
      enabled: enabledInput?.checked ?? DEFAULT_EXTENSION_ENABLED,
      targetLang: getSelectedTargetLangForSave(),
      provider: selectedProvider,
      codexModel:
        modelProvider === "codex"
          ? selectedModel
          : current.hoverTransPort?.codexModel,
      modelsByProvider,
      triggerHotkey: currentTriggerHotkey,
      timeoutMs: timeoutSecondsInputToMs(timeoutInput?.value),
      cacheEnabled: cacheEnabledInput?.checked ?? DEFAULT_CACHE_ENABLED,
      debugLogging: debugLoggingInput?.checked ?? DEFAULT_DEBUG_LOGGING
    }
  });
  setSaveState("Saved.");
}

async function resetProviderModel() {
  const selectedProvider = normalizeProvider(providerInput?.value);
  const modelProvider = resolveProviderForModel(selectedProvider);

  if (providerModelInput) {
    providerModelInput.value =
      getDefaultModelForProvider(modelProvider) || DEFAULT_CODEX_MODEL;
  }

  await saveOptions();
}

function formatNativeHostReadyStatus(
  response: Extract<ExtensionResponse, { type: "NATIVE_HOST_STATUS"; ok: true }>
): string {
  const details = [
    `Host ${response.hostVersion}`,
    `Protocol ${response.protocolVersion}`,
    `Bridge ${response.bridgeVersion}`
  ];

  if (response.appVersion) {
    details.push(`App ${response.appVersion}`);
  }

  return `Connected. ${details.join(" · ")}.`;
}

async function checkNativeHost() {
  const requestId = createRequestId();
  setNativeHostStatus("Checking...");

  const response = await chrome.runtime.sendMessage<
    ExtensionRequest,
    ExtensionResponse
  >({
    type: "CHECK_NATIVE_HOST",
    requestId
  });

  if (response?.type !== "NATIVE_HOST_STATUS" || response.requestId !== requestId) {
    setNativeHostStatus("Native Host check returned an invalid response.");
    return;
  }

  if (response.ok) {
    setNativeHostStatus(formatNativeHostReadyStatus(response));
    return;
  }

  if (response.error === "NATIVE_HOST_UNAVAILABLE") {
    setNativeHostStatus("Native Host is not installed or not reachable.");
    return;
  }

  if (response.error === "NATIVE_HOST_UPDATE_REQUIRED") {
    setNativeHostStatus(`${response.message} Install or update the Native Host.`);
    return;
  }

  if (response.error === "NATIVE_HOST_UNSUPPORTED") {
    setNativeHostStatus(`${response.message} Update this extension.`);
    return;
  }

  setNativeHostStatus(response.message);
}

async function checkProviderStatus() {
  const requestId = createRequestId();
  const selectedProvider = normalizeProvider(providerInput?.value);
  const providerId = resolveProviderForModel(selectedProvider);
  const providerLabel = getProviderLabel(providerId);
  setProviderStatus(`Checking ${providerLabel}...`);

  const response = await chrome.runtime.sendMessage<
    ExtensionRequest,
    ExtensionResponse
  >({
    type: "CHECK_PROVIDER_STATUS",
    requestId
  });

  if (response?.type !== "PROVIDER_STATUS" || response.requestId !== requestId) {
    setProviderStatus(`${providerLabel} check returned an invalid response.`);
    return;
  }

  if (!response.ok) {
    setProviderStatus(response.message);
    return;
  }

  const selectedStatus = response.providers.find(
    (provider) => provider.id === providerId
  );

  if (!selectedStatus) {
    setProviderStatus(`${providerLabel} status was not returned.`);
    return;
  }

  if (!selectedStatus.available) {
    setProviderStatus(
      `Unavailable. ${selectedStatus.error ?? `${providerLabel} was not found.`}`
    );
    return;
  }

  const details = [selectedStatus.version, selectedStatus.binaryPath]
    .filter(Boolean)
    .join(" · ");
  setProviderStatus(details ? `Available. ${details}` : "Available.");
}

async function clearCache() {
  const requestId = createRequestId();
  setCacheStatus("Clearing...");

  const response = await chrome.runtime.sendMessage<
    ExtensionRequest,
    ExtensionResponse
  >({
    type: "CLEAR_TRANSLATION_CACHE",
    requestId
  });

  if (
    response?.type !== "CACHE_CLEAR_RESULT" ||
    response.requestId !== requestId
  ) {
    setCacheStatus("Cache clear returned an invalid response.");
    return;
  }

  if (!response.ok) {
    setCacheStatus(response.message);
    return;
  }

  setCacheStatus(`Cleared ${response.deletedRows} cached translations.`);
}

async function clearDebugLog() {
  const requestId = createRequestId();
  setDebugLogStatus("Clearing...");

  const response = await chrome.runtime.sendMessage<
    ExtensionRequest,
    ExtensionResponse
  >({
    type: "CLEAR_DEBUG_LOG",
    requestId
  });

  if (
    response?.type !== "DEBUG_LOG_CLEAR_RESULT" ||
    response.requestId !== requestId
  ) {
    setDebugLogStatus("Debug log clear returned an invalid response.");
    return;
  }

  if (!response.ok) {
    setDebugLogStatus(response.message);
    return;
  }

  setDebugLogPath(response.logPath);
  setDebugLogStatus("Debug log cleared.");
  await loadDebugLogContent();
}

populateTargetLanguageOptions();

enabledInput?.addEventListener("change", () => {
  saveOptions().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    setSaveState(message);
  });
});

targetLanguageInput?.addEventListener("change", () => {
  updateTargetLanguageCustomVisibility();

  if (targetLanguageInput.value === CUSTOM_TARGET_LANG_VALUE) {
    targetLanguageCustomInput?.focus();
  }

  saveOptions().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    setSaveState(message);
  });
});

targetLanguageCustomInput?.addEventListener("change", () => {
  saveOptions().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    setSaveState(message);
  });
});

providerInput?.addEventListener("change", () => {
  saveOptions()
    .then(checkProviderStatus)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      setSaveState(message);
      setProviderStatus(message);
    });
});

providerModelInput?.addEventListener("change", () => {
  saveOptions().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    setSaveState(message);
  });
});

timeoutInput?.addEventListener("change", () => {
  if (timeoutInput) {
    timeoutInput.value = String(
      timeoutMsToSeconds(timeoutSecondsInputToMs(timeoutInput.value))
    );
  }

  saveOptions().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    setSaveState(message);
  });
});

cacheEnabledInput?.addEventListener("change", () => {
  saveOptions().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    setSaveState(message);
  });
});

triggerHotkeyRecordButton?.addEventListener("click", () => {
  if (isRecordingTriggerHotkey) {
    stopTriggerHotkeyRecording("Canceled.");
    return;
  }

  startTriggerHotkeyRecording();
});

triggerHotkeyResetButton?.addEventListener("click", () => {
  stopTriggerHotkeyRecording();
  setTriggerHotkeyInput(DEFAULT_TRIGGER_HOTKEY);
  saveOptions()
    .then(() => {
      setTriggerHotkeyStatus("Saved.");
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      setSaveState(message);
      setTriggerHotkeyStatus(message);
    });
});

debugLoggingInput?.addEventListener("change", () => {
  saveOptions()
    .then(loadDebugLogInfo)
    .then(loadDebugLogContent)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      setSaveState(message);
    });
});

providerModelResetButton?.addEventListener("click", () => {
  resetProviderModel().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    setSaveState(message);
  });
});

nativeHostPingButton?.addEventListener("click", () => {
  checkNativeHost().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    setNativeHostStatus(message);
  });
});

providerStatusCheckButton?.addEventListener("click", () => {
  checkProviderStatus().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    setProviderStatus(message);
  });
});

cacheClearButton?.addEventListener("click", () => {
  clearCache().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    setCacheStatus(message);
  });
});

debugLogClearButton?.addEventListener("click", () => {
  clearDebugLog().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    setDebugLogStatus(message);
  });
});

debugLogRefreshButton?.addEventListener("click", () => {
  loadDebugLogInfo()
    .then(loadDebugLogContent)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      setDebugLogStatus(message);
    });
});

loadOptions()
  .then(checkProviderStatus)
  .then(loadDebugLogInfo)
  .then(loadDebugLogContent)
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    setDebugLogPath("Unavailable");
    setDebugLogStatus(message);
    setSaveState(message);
});
