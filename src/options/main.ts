import "./options.css";
import type {
  ExtensionRequest,
  ExtensionResponse,
  NativeHostUpdateStoredStatus
} from "../shared/messages";
import { formatNativeHostUpdateStatusForUser } from "../shared/nativeHostUpdate";
import {
  getDefaultModelForProvider,
  getFallbackModelCatalog,
  getProviderLabel,
  resolveProviderForModel,
  type ProviderId,
  type ProviderModelCatalog,
  type ProviderSelection
} from "../shared/providers";
import {
  COMMON_TARGET_LANGUAGES,
  CUSTOM_TARGET_LANG_VALUE,
  DEFAULT_CACHE_ENABLED,
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
  normalizeNativeHostUpdateAutoCheck,
  normalizeProvider,
  normalizeProviderModel,
  normalizeTargetLang,
  normalizeTriggerHotkey,
  normalizeTimeoutMs,
  type CommonTargetLanguage,
  type HoverTransPortOptions,
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
const nativeHostUpdateAutoCheckInput = document.querySelector<HTMLInputElement>(
  "#native-host-update-auto-check"
);
const nativeHostUpdateStatus = document.querySelector<HTMLParagraphElement>(
  "#native-host-update-status"
);
const nativeHostUpdateCheckButton =
  document.querySelector<HTMLButtonElement>("#native-host-update-check");
const nativeHostUpdateApplyButton =
  document.querySelector<HTMLButtonElement>("#native-host-update-apply");
const nativeHostUpdateCurrentVersion = document.querySelector<HTMLElement>(
  "#native-host-update-current-version"
);
const nativeHostUpdateLatestVersion = document.querySelector<HTMLElement>(
  "#native-host-update-latest-version"
);
const nativeHostUpdateLastChecked = document.querySelector<HTMLElement>(
  "#native-host-update-last-checked"
);
const nativeHostUpdateNextCheck = document.querySelector<HTMLElement>(
  "#native-host-update-next-check"
);
const providerInput = document.querySelector<HTMLSelectElement>("#provider");
const providerStatusCheckButton =
  document.querySelector<HTMLButtonElement>("#provider-status-check");
const providerModelResetButton =
  document.querySelector<HTMLButtonElement>("#provider-model-reset");
const providerModelInput =
  document.querySelector<HTMLSelectElement>("#provider-model");
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
let currentModelCatalog: ProviderModelCatalog | undefined;
const providerModelCatalogCache = new Map<ProviderId, ProviderModelCatalog>();
let providerStatusCheckSequence = 0;
let nativeHostUpdateApplyAvailable = false;
let isApplyingNativeHostUpdate = false;

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

function setNativeHostUpdateStatus(message: string) {
  if (nativeHostUpdateStatus) {
    nativeHostUpdateStatus.textContent = message;
  }
}

function setNativeHostUpdateApplyEnabled(enabled: boolean) {
  nativeHostUpdateApplyAvailable = enabled;

  if (nativeHostUpdateApplyButton) {
    nativeHostUpdateApplyButton.disabled = !enabled;
  }
}

function setNativeHostUpdateChecking(checking: boolean) {
  if (nativeHostUpdateCheckButton) {
    nativeHostUpdateCheckButton.disabled = checking;
    nativeHostUpdateCheckButton.textContent = checking
      ? "Checking..."
      : "Check for Updates";
  }
}

function setNativeHostUpdateApplying(applying: boolean) {
  if (nativeHostUpdateApplyButton) {
    nativeHostUpdateApplyButton.disabled =
      applying || !nativeHostUpdateApplyAvailable;
    nativeHostUpdateApplyButton.textContent = applying
      ? "Updating..."
      : "Update Native Host";
  }
}

function setNativeHostUpdateMeta(
  currentVersion: string,
  latestVersion: string,
  lastChecked: string,
  nextCheck: string
) {
  if (nativeHostUpdateCurrentVersion) {
    nativeHostUpdateCurrentVersion.textContent = currentVersion;
  }

  if (nativeHostUpdateLatestVersion) {
    nativeHostUpdateLatestVersion.textContent = latestVersion;
  }

  if (nativeHostUpdateLastChecked) {
    nativeHostUpdateLastChecked.textContent = lastChecked;
  }

  if (nativeHostUpdateNextCheck) {
    nativeHostUpdateNextCheck.textContent = nextCheck;
  }
}

function formatNativeHostUpdateDateTime(timestamp: number | undefined): string {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return "Unknown";
  }

  const date = new Date(timestamp);

  if (!Number.isFinite(date.getTime())) {
    return "Unknown";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  } catch {
    return "Unknown";
  }
}

function setProviderStatus(message: string) {
  if (providerStatus) {
    providerStatus.textContent = message;
  }
}

function getSelectedProvider(): ProviderSelection {
  return normalizeProvider(providerInput?.value);
}

function setProviderModelInput(
  provider: ProviderSelection,
  options: HoverTransPortOptions | undefined
) {
  setProviderModelInputForProvider(provider, getModelForProvider(options, provider));
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

function populateProviderModelOptions(
  provider: ProviderSelection,
  selectedModel: string | undefined,
  catalog = getProviderModelCatalog(provider)
) {
  if (!providerModelInput) {
    return;
  }

  const providerId = resolveProviderForModel(provider);
  const normalizedModel = normalizeProviderModel(providerId, selectedModel);
  const modelOptions = catalog.models;
  providerModelInput.replaceChildren();

  for (const modelOption of modelOptions) {
    const option = document.createElement("option");
    option.value = modelOption.value;
    option.textContent = modelOption.recommended
      ? `${modelOption.label} (Recommended)`
      : modelOption.label;
    providerModelInput.append(option);
  }

  if (
    catalog.supportsCustomModel &&
    normalizedModel &&
    !modelOptions.some((modelOption) => modelOption.value === normalizedModel)
  ) {
    const option = document.createElement("option");
    option.value = normalizedModel;
    option.textContent = `Custom (${normalizedModel})`;
    providerModelInput.append(option);
  }

  if (!providerModelInput.options.length) {
    const option = document.createElement("option");
    option.value = normalizedModel;
    option.textContent = normalizedModel || "Default";
    providerModelInput.append(option);
  }

  providerModelInput.value = normalizedModel;
}

function getProviderModelCatalog(provider: ProviderSelection): ProviderModelCatalog {
  const providerId = resolveProviderForModel(provider);

  if (currentModelCatalog?.provider === providerId) {
    return currentModelCatalog;
  }

  return (
    providerModelCatalogCache.get(providerId) ??
    getFallbackModelCatalog(providerId)
  );
}

function isCurrentProviderStatusCheck(
  sequence: number,
  provider: ProviderSelection
): boolean {
  return sequence === providerStatusCheckSequence && getSelectedProvider() === provider;
}

async function loadProviderModelCatalog(
  provider: ProviderSelection,
  statusCheckSequence?: number
): Promise<ProviderModelCatalog | undefined> {
  const providerId = resolveProviderForModel(provider);
  const stored = (await chrome.storage.local.get(
    "hoverTransPort"
  )) as StoredOptions;
  let catalog =
    providerModelCatalogCache.get(providerId) ?? getFallbackModelCatalog(providerId);

  if (
    statusCheckSequence === undefined ||
    isCurrentProviderStatusCheck(statusCheckSequence, provider)
  ) {
    currentModelCatalog = catalog;
  }

  try {
    const response = await chrome.runtime.sendMessage<
      ExtensionRequest,
      ExtensionResponse
    >({
      type: "GET_PROVIDER_MODELS",
      requestId: createRequestId(),
      provider
    });

    catalog =
      response?.type === "PROVIDER_MODELS_RESULT" && response.ok
        ? response.catalog
        : response?.type === "PROVIDER_MODELS_RESULT"
          ? response.fallbackCatalog
          : getFallbackModelCatalog(providerId);
    providerModelCatalogCache.set(providerId, catalog);
  } catch {
    catalog = getFallbackModelCatalog(providerId);
    providerModelCatalogCache.set(providerId, catalog);
  }

  if (
    statusCheckSequence !== undefined &&
    !isCurrentProviderStatusCheck(statusCheckSequence, provider)
  ) {
    return undefined;
  }

  currentModelCatalog = catalog;
  populateProviderModelOptions(
    provider,
    getModelForProvider(stored.hoverTransPort, provider),
    catalog
  );
  return catalog;
}

function setProviderModelInputForProvider(
  provider: ProviderSelection,
  model: string | undefined
) {
  populateProviderModelOptions(provider, model);
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

  if (providerInput) {
    providerInput.value =
      selectedProvider === "auto" ? DEFAULT_PROVIDER : selectedProvider;
  }

  setProviderModelInput(selectedProvider, options.hoverTransPort);

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

  if (nativeHostUpdateAutoCheckInput) {
    nativeHostUpdateAutoCheckInput.checked = normalizeNativeHostUpdateAutoCheck(
      options.hoverTransPort?.nativeHostUpdateAutoCheck
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

async function saveOptions(
  { persistProviderModel = true }: { persistProviderModel?: boolean } = {}
) {
  const current = (await chrome.storage.local.get(
    "hoverTransPort"
  )) as StoredOptions;
  const selectedProvider = getSelectedProvider();
  const modelProvider = resolveProviderForModel(selectedProvider);
  const nextOptions: HoverTransPortOptions = {
    ...current.hoverTransPort,
    enabled: enabledInput?.checked ?? DEFAULT_EXTENSION_ENABLED,
    targetLang: getSelectedTargetLangForSave(),
    provider: selectedProvider,
    modelsByProvider: current.hoverTransPort?.modelsByProvider,
    codexModel: current.hoverTransPort?.codexModel,
    triggerHotkey: currentTriggerHotkey,
    timeoutMs: timeoutSecondsInputToMs(timeoutInput?.value),
    cacheEnabled: cacheEnabledInput?.checked ?? DEFAULT_CACHE_ENABLED,
    debugLogging: debugLoggingInput?.checked ?? DEFAULT_DEBUG_LOGGING,
    nativeHostUpdateAutoCheck: normalizeNativeHostUpdateAutoCheck(
      nativeHostUpdateAutoCheckInput?.checked
    )
  };

  if (persistProviderModel) {
    const selectedModel = normalizeProviderModel(
      modelProvider,
      providerModelInput?.value
    );

    nextOptions.modelsByProvider = {
      ...current.hoverTransPort?.modelsByProvider,
      [modelProvider]: selectedModel
    };
    nextOptions.codexModel =
      modelProvider === "codex"
        ? selectedModel
        : current.hoverTransPort?.codexModel;
  }

  await chrome.storage.local.set({
    hoverTransPort: nextOptions
  });
  setSaveState("Saved.");
}

async function resetProviderModel() {
  const selectedProvider = getSelectedProvider();
  const modelProvider = resolveProviderForModel(selectedProvider);

  setProviderModelInputForProvider(
    selectedProvider,
    getDefaultModelForProvider(modelProvider)
  );

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

function formatProviderModelCatalogSourceStatus(
  catalog: ProviderModelCatalog | undefined,
  providerLabel: string
): string {
  if (!catalog) {
    return "";
  }

  return catalog.source === "cli"
    ? `Models loaded from ${providerLabel}.`
    : "Models loaded from fallback aliases.";
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

function renderNativeHostUpdateStatus(
  status: NativeHostUpdateStoredStatus | undefined
) {
  if (!status) {
    setNativeHostUpdateStatus("Update status not checked.");
    setNativeHostUpdateMeta("Unknown", "Unknown", "Never", "Unknown");
    setNativeHostUpdateApplyEnabled(false);
    return;
  }

  const lastChecked = formatNativeHostUpdateDateTime(status.checkedAt);
  const nextCheck = formatNativeHostUpdateDateTime(status.nextCheckAt);

  if (!status.ok) {
    setNativeHostUpdateStatus(formatNativeHostUpdateStatusForUser(status).detail);
    setNativeHostUpdateMeta("Unknown", "Unknown", lastChecked, nextCheck);
    setNativeHostUpdateApplyEnabled(false);
    return;
  }

  setNativeHostUpdateMeta(
    status.installedVersion,
    status.latestVersion,
    lastChecked,
    nextCheck
  );

  if (status.updateAvailable) {
    setNativeHostUpdateStatus(formatNativeHostUpdateStatusForUser(status).detail);
    setNativeHostUpdateApplyEnabled(true);
    return;
  }

  setNativeHostUpdateStatus(formatNativeHostUpdateStatusForUser(status).detail);
  setNativeHostUpdateApplyEnabled(false);
}

async function loadNativeHostUpdateStatus() {
  const requestId = createRequestId();
  const response = await chrome.runtime.sendMessage<
    ExtensionRequest,
    ExtensionResponse
  >({
    type: "GET_STORED_NATIVE_HOST_UPDATE_STATUS",
    requestId
  });

  if (
    response?.type === "NATIVE_HOST_UPDATE_STATUS" &&
    response.requestId === requestId
  ) {
    renderNativeHostUpdateStatus(response.status);
  }
}

async function checkNativeHostUpdate() {
  const requestId = createRequestId();
  setNativeHostUpdateStatus("Checking for updates...");
  setNativeHostUpdateApplyEnabled(false);
  setNativeHostUpdateChecking(true);

  try {
    const response = await chrome.runtime.sendMessage<
      ExtensionRequest,
      ExtensionResponse
    >({
      type: "CHECK_NATIVE_HOST_UPDATE",
      requestId
    });

    if (
      response?.type === "NATIVE_HOST_UPDATE_STATUS" &&
      response.requestId === requestId
    ) {
      renderNativeHostUpdateStatus(response.status);
      return;
    }

    setNativeHostUpdateStatus("Could not check for updates.");
  } finally {
    setNativeHostUpdateChecking(false);
  }
}

async function getStoredNativeHostUpdateStatus() {
  const requestId = createRequestId();
  const response = await chrome.runtime.sendMessage<
    ExtensionRequest,
    ExtensionResponse
  >({
    type: "GET_STORED_NATIVE_HOST_UPDATE_STATUS",
    requestId
  });

  if (
    response?.type === "NATIVE_HOST_UPDATE_STATUS" &&
    response.requestId === requestId
  ) {
    return response.status;
  }

  return undefined;
}

async function applyNativeHostUpdate() {
  if (isApplyingNativeHostUpdate) {
    return;
  }

  isApplyingNativeHostUpdate = true;
  setNativeHostUpdateApplying(true);

  try {
    const status = await getStoredNativeHostUpdateStatus();
    const canRetry = status?.ok === true && status.updateAvailable === true;

    if (!canRetry) {
      setNativeHostUpdateStatus("No native host update is available.");
      setNativeHostUpdateApplyEnabled(false);
      return;
    }

    const requestId = createRequestId();
    setNativeHostUpdateStatus("Updating native host...");
    const response = await chrome.runtime.sendMessage<
      ExtensionRequest,
      ExtensionResponse
    >({
      type: "UPDATE_NATIVE_HOST",
      requestId,
      targetTag: status.latestTag,
      targetVersion: status.latestVersion
    });

    if (
      response?.type === "NATIVE_HOST_UPDATE_RESULT" &&
      response.requestId === requestId &&
      response.ok
    ) {
      setNativeHostUpdateStatus(
        `Updated native host to ${response.installedVersion}.`
      );
      setNativeHostUpdateApplyEnabled(false);
      await checkNativeHost();
      await checkNativeHostUpdate();
      return;
    }

    if (
      response?.type === "NATIVE_HOST_UPDATE_RESULT" &&
      response.requestId === requestId &&
      !response.ok
    ) {
      setNativeHostUpdateStatus(response.message);
      setNativeHostUpdateApplyEnabled(canRetry);
      return;
    }

    setNativeHostUpdateStatus("Native host update failed.");
    setNativeHostUpdateApplyEnabled(canRetry);
  } finally {
    isApplyingNativeHostUpdate = false;
    setNativeHostUpdateApplying(false);
  }
}

async function checkProviderStatus() {
  const statusCheckSequence = ++providerStatusCheckSequence;
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
    requestId,
    provider: selectedProvider
  });

  if (!isCurrentProviderStatusCheck(statusCheckSequence, selectedProvider)) {
    return;
  }

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
  const catalog = await loadProviderModelCatalog(
    selectedProvider,
    statusCheckSequence
  );

  if (!isCurrentProviderStatusCheck(statusCheckSequence, selectedProvider)) {
    return;
  }

  const catalogSourceStatus = formatProviderModelCatalogSourceStatus(
    catalog,
    providerLabel
  );

  if (providerId === "claude") {
    setProviderStatus(
      [
        details ? `Available. ${details}.` : "Available. Claude binary is available.",
        catalogSourceStatus,
        "Claude authentication is verified when translating."
      ]
        .filter(Boolean)
        .join(" ")
    );
    return;
  }

  setProviderStatus(
    [details ? `Available. ${details}.` : "Available.", catalogSourceStatus]
      .filter(Boolean)
      .join(" ")
  );
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
  chrome.storage.local
    .get("hoverTransPort")
    .then((current) => {
      const storedOptions = current as StoredOptions;
      setProviderModelInput(getSelectedProvider(), storedOptions.hoverTransPort);
      return saveOptions({ persistProviderModel: false });
    })
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

nativeHostUpdateAutoCheckInput?.addEventListener("change", () => {
  saveOptions()
    .then(loadNativeHostUpdateStatus)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      setSaveState(message);
      setNativeHostUpdateStatus(message);
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

nativeHostUpdateCheckButton?.addEventListener("click", () => {
  checkNativeHostUpdate().catch((error: unknown) => {
    setNativeHostUpdateStatus(
      error instanceof Error ? error.message : "Could not check for updates."
    );
  });
});

nativeHostUpdateApplyButton?.addEventListener("click", () => {
  applyNativeHostUpdate().catch((error: unknown) => {
    setNativeHostUpdateStatus(
      error instanceof Error ? error.message : "Native host update failed."
    );
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
  .then(loadNativeHostUpdateStatus)
  .then(loadDebugLogInfo)
  .then(loadDebugLogContent)
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    setDebugLogPath("Unavailable");
    setDebugLogStatus(message);
    setSaveState(message);
});
