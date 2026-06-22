import { getHoverBlockTarget } from "./blockExtractor";
import {
  BubbleRenderer,
  type BubbleDismissReason
} from "./bubbleRenderer";
import { HoverTracker } from "./hoverTracker";
import { InlineRenderer } from "./inlineRenderer";
import { installHotkeyTrigger } from "./leftControlTrigger";
import { getSelectionTarget } from "./selectionExtractor";
import {
  getSelectionTargetKeyPrefix,
  getTargetKey,
  hasTargetSourceElement
} from "./targetIdentity";
import type {
  DebugLogFields,
  ExtensionRequest,
  ExtensionResponse,
  TranslationResultResponse,
  TranslationTarget
} from "../shared/messages";
import type {
  HoverTransPortOptions,
  StoredOptions,
  TriggerHotkey
} from "../shared/options";
import type { ModifierTriggerCode } from "../shared/hotkeys";
import { startYouTubeSubtitleSession } from "./youtubeSubtitleSession";

const hoverTracker = new HoverTracker();
const inlineRenderer = new InlineRenderer();
const selectionBubbleStates = new Map<string, SelectionBubbleStoredState>();
let visibleSelectionBubbleKey: string | null = null;
const bubbleRenderer = new BubbleRenderer(handleSelectionBubbleDismissed);
const DEFAULT_EXTENSION_ENABLED = true;
const TRANSLATION_STATUS_LOADING = "loading";
const TRANSLATION_STATUS_SUCCESS = "success";
const TRANSLATION_STATUS_ERROR = "error";
const TRANSLATION_STATUS_HIDDEN = "hidden";
// Keep runtime hotkey validation local so the MV3 content script remains a
// single non-module bundle after Vite/Rollup builds it.
const DEFAULT_TRIGGER_HOTKEY: TriggerHotkey = {
  kind: "modifier",
  code: "ControlLeft"
};
const MODIFIER_TRIGGER_CODES = new Set<ModifierTriggerCode>([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight"
]);
const MODIFIER_KEYBOARD_CODES = new Set([
  ...MODIFIER_TRIGGER_CODES,
  "MetaLeft",
  "MetaRight",
  "Control",
  "Alt",
  "Shift",
  "Meta"
]);
const RESERVED_TRIGGER_COMBO_CODES = new Set([
  "KeyA",
  "KeyC",
  "KeyF",
  "KeyL",
  "KeyN",
  "KeyP",
  "KeyR",
  "KeyS",
  "KeyT",
  "KeyV",
  "KeyW",
  "KeyX"
]);
const MODIFIER_TRIGGER_CODE_ORDER = new Map(
  Array.from(MODIFIER_TRIGGER_CODES, (code, index) => [code, index])
);

type TranslationStateStatus =
  | typeof TRANSLATION_STATUS_LOADING
  | typeof TRANSLATION_STATUS_SUCCESS
  | typeof TRANSLATION_STATUS_ERROR
  | typeof TRANSLATION_STATUS_HIDDEN;

type TranslationState = {
  status: TranslationStateStatus;
  requestId?: string;
};

type SelectionBubbleStoredState =
  | {
      status: typeof TRANSLATION_STATUS_LOADING;
      requestId: string;
      anchorRect: TranslationTarget["anchorRect"];
    }
  | {
      status: typeof TRANSLATION_STATUS_SUCCESS;
      text: string;
      anchorRect: TranslationTarget["anchorRect"];
    }
  | {
      status: typeof TRANSLATION_STATUS_ERROR;
      text: string;
      anchorRect: TranslationTarget["anchorRect"];
    }
  | {
      status: typeof TRANSLATION_STATUS_HIDDEN;
      lastResult?:
        | { status: typeof TRANSLATION_STATUS_SUCCESS; text: string }
        | { status: typeof TRANSLATION_STATUS_ERROR; text: string };
      anchorRect: TranslationTarget["anchorRect"];
    };

const translationStates = new Map<string, TranslationState>();
let activeTriggerHotkey: TriggerHotkey = DEFAULT_TRIGGER_HOTKEY;
let uninstallTranslationTrigger: (() => void) | null = null;

function createRequestId(): string {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()}`;
}

function hasActiveSelection(): boolean {
  const selection = window.getSelection();

  return Boolean(selection && selection.rangeCount > 0 && !selection.isCollapsed);
}

function getCurrentTranslationTarget(): TranslationTarget | null {
  const selectionTarget = getSelectionTarget();

  if (selectionTarget || hasActiveSelection()) {
    return selectionTarget;
  }

  return getHoverBlockTarget(hoverTracker.getCurrentElement());
}

function isTranslationResult(
  response: ExtensionResponse | undefined
): response is TranslationResultResponse {
  return response?.type === "TRANSLATE_RESULT";
}

async function isExtensionEnabled(): Promise<boolean> {
  const options = (await chrome.storage.local.get(
    "hoverTransPort"
  )) as StoredOptions;
  const enabled = options.hoverTransPort?.enabled;

  return typeof enabled === "boolean" ? enabled : DEFAULT_EXTENSION_ENABLED;
}

function getTriggerHotkeyFromOptions(
  options: HoverTransPortOptions | undefined
): TriggerHotkey {
  const hotkey = options?.triggerHotkey;

  if (!hotkey || typeof hotkey !== "object") {
    return DEFAULT_TRIGGER_HOTKEY;
  }

  if (
    hotkey.kind === "modifier" &&
    MODIFIER_TRIGGER_CODES.has(hotkey.code)
  ) {
    return hotkey;
  }

  if (hotkey.kind === "modifierChord" && Array.isArray(hotkey.codes)) {
    const rawCodes: Array<unknown> = hotkey.codes;
    const codes = Array.from(
      new Set(
        rawCodes.filter((code): code is ModifierTriggerCode => {
          return (
            typeof code === "string" &&
            MODIFIER_TRIGGER_CODES.has(code as ModifierTriggerCode)
          );
        })
      )
    ).sort((left, right) => {
      return (
        (MODIFIER_TRIGGER_CODE_ORDER.get(left) ?? 0) -
        (MODIFIER_TRIGGER_CODE_ORDER.get(right) ?? 0)
      );
    });

    const families = new Set(
      codes.map((code) => {
        if (code.startsWith("Control")) {
          return "Control";
        }

        if (code.startsWith("Alt")) {
          return "Alt";
        }

        return "Shift";
      })
    );

    if (
      codes.length >= 2 &&
      codes.length === hotkey.codes.length &&
      families.size === codes.length
    ) {
      return {
        kind: "modifierChord",
        codes: codes as [
          ModifierTriggerCode,
          ModifierTriggerCode,
          ...ModifierTriggerCode[]
        ]
      };
    }
  }

  if (
    hotkey.kind === "combo" &&
    typeof hotkey.code === "string" &&
    typeof hotkey.ctrlKey === "boolean" &&
    typeof hotkey.shiftKey === "boolean" &&
    typeof hotkey.altKey === "boolean" &&
    typeof hotkey.metaKey === "boolean" &&
    (hotkey.ctrlKey || hotkey.shiftKey || hotkey.altKey || hotkey.metaKey) &&
    !MODIFIER_KEYBOARD_CODES.has(hotkey.code) &&
    !(
      RESERVED_TRIGGER_COMBO_CODES.has(hotkey.code) &&
      (hotkey.ctrlKey || hotkey.metaKey) &&
      !hotkey.altKey
    )
  ) {
    return hotkey;
  }

  return DEFAULT_TRIGGER_HOTKEY;
}

function areTriggerHotkeysEqual(
  left: TriggerHotkey,
  right: TriggerHotkey
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function loadStoredTriggerHotkey(): Promise<TriggerHotkey> {
  const options = (await chrome.storage.local.get(
    "hoverTransPort"
  )) as StoredOptions;

  return getTriggerHotkeyFromOptions(options.hoverTransPort);
}

function installTranslationTrigger(hotkey: TriggerHotkey): void {
  if (
    uninstallTranslationTrigger &&
    areTriggerHotkeysEqual(activeTriggerHotkey, hotkey)
  ) {
    return;
  }

  uninstallTranslationTrigger?.();
  activeTriggerHotkey = hotkey;
  uninstallTranslationTrigger = installHotkeyTrigger(() => {
    void handleTranslateTrigger().catch(() => undefined);
  }, hotkey);
}

function handleStoredOptionsChanged(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string
): void {
  if (areaName !== "local" || !changes.hoverTransPort) {
    return;
  }

  const nextOptions = changes.hoverTransPort.newValue as
    | HoverTransPortOptions
    | undefined;
  installTranslationTrigger(getTriggerHotkeyFromOptions(nextOptions));
}

function describeTarget(target: TranslationTarget): DebugLogFields {
  return {
    ownerKey: target.sourceElement.ownerKey,
    mode: target.mode,
    tagName: target.sourceElement.tagName,
    textLength: target.text.length,
    inlineAnnotationCount: target.inlineAnnotations?.length ?? 0
  };
}

function writeContentDebugEvent(
  event: string,
  fields: DebugLogFields = {}
): void {
  const requestId = createRequestId();

  void chrome.runtime
    .sendMessage<ExtensionRequest, ExtensionResponse>({
      type: "WRITE_DEBUG_LOG_EVENT",
      requestId,
      event,
      fields
    })
    .catch(() => undefined);
}

function setTranslationState(
  target: TranslationTarget,
  status: TranslationStateStatus,
  requestId?: string
): void {
  const state: TranslationState = { status };

  if (requestId) {
    state.requestId = requestId;
  }

  translationStates.set(getTargetKey(target), state);
  writeContentDebugEvent(`content.state.${status}`, {
    ...describeTarget(target),
    translationRequestId: requestId ?? null
  });
}

function setTranslationStateByKey(
  key: string,
  status: TranslationStateStatus,
  requestId?: string
): void {
  const state: TranslationState = { status };

  if (requestId) {
    state.requestId = requestId;
  }

  translationStates.set(key, state);
}

function clearTranslationState(
  target: TranslationTarget,
  event: string,
  fields: DebugLogFields = {}
): void {
  translationStates.delete(getTargetKey(target));
  writeContentDebugEvent(event, {
    ...describeTarget(target),
    ...fields
  });
}

function clearOtherSelectionTranslationStates(target: TranslationTarget): void {
  const selectionKeyPrefix = getSelectionTargetKeyPrefix(target);

  if (!selectionKeyPrefix) {
    return;
  }

  const targetKey = getTargetKey(target);

  translationStates.delete(target.sourceElement.ownerKey);

  for (const key of translationStates.keys()) {
    if (key !== targetKey && key.startsWith(selectionKeyPrefix)) {
      translationStates.delete(key);
    }
  }
}

function getTranslationState(target: TranslationTarget): TranslationState | null {
  return translationStates.get(getTargetKey(target)) ?? null;
}

function isActiveRequest(
  target: TranslationTarget,
  requestId: string
): boolean {
  const state = getTranslationState(target);

  return (
    state?.status === TRANSLATION_STATUS_LOADING &&
    state.requestId === requestId
  );
}

function logIgnoredResponse(
  target: TranslationTarget,
  requestId: string,
  reason: string
): void {
  const state = getTranslationState(target);

  writeContentDebugEvent("content.response.ignored", {
    ...describeTarget(target),
    reason,
    translationRequestId: requestId,
    activeRequestId: state?.requestId ?? null,
    activeStatus: state?.status ?? null
  });
}

function clearVisibleSelectionBubble(): void {
  if (visibleSelectionBubbleKey) {
    translationStates.delete(visibleSelectionBubbleKey);
  }

  visibleSelectionBubbleKey = null;
  bubbleRenderer.dismiss("programmatic", { notify: false });
}

function markVisibleSelectionBubbleHidden(): void {
  if (!visibleSelectionBubbleKey) {
    bubbleRenderer.dismiss("programmatic", { notify: false });
    return;
  }

  const key = visibleSelectionBubbleKey;
  const state = selectionBubbleStates.get(key);
  const lastResult =
    state?.status === TRANSLATION_STATUS_SUCCESS ||
    state?.status === TRANSLATION_STATUS_ERROR
      ? { status: state.status, text: state.text }
      : state?.status === TRANSLATION_STATUS_HIDDEN
        ? state.lastResult
        : undefined;

  selectionBubbleStates.set(key, {
    status: TRANSLATION_STATUS_HIDDEN,
    ...(lastResult ? { lastResult } : {}),
    anchorRect: state?.anchorRect ?? {
      top: 0,
      left: 0,
      width: 0,
      height: 0
    }
  });
  setTranslationStateByKey(key, TRANSLATION_STATUS_HIDDEN);
  visibleSelectionBubbleKey = null;
  bubbleRenderer.dismiss("programmatic", { notify: false });
}

function showHiddenSelectionBubbleIfAvailable(
  target: TranslationTarget
): boolean {
  if (target.mode !== "selection") {
    return false;
  }

  const key = getTargetKey(target);
  const state = selectionBubbleStates.get(key);
  const lastResult =
    state?.status === TRANSLATION_STATUS_HIDDEN
      ? state.lastResult
      : visibleSelectionBubbleKey !== key &&
          (state?.status === TRANSLATION_STATUS_SUCCESS ||
            state?.status === TRANSLATION_STATUS_ERROR)
        ? { status: state.status, text: state.text }
        : undefined;

  if (!lastResult) {
    return false;
  }

  bubbleRenderer.show(target.anchorRect, {
    status: lastResult.status,
    text: lastResult.text
  });
  visibleSelectionBubbleKey = key;
  selectionBubbleStates.set(key, {
    status: lastResult.status,
    text: lastResult.text,
    anchorRect: target.anchorRect
  });
  setTranslationState(target, lastResult.status);
  return true;
}

function handleSelectionBubbleDismissed(reason: BubbleDismissReason): void {
  if (reason === "programmatic") {
    return;
  }

  markVisibleSelectionBubbleHidden();
}

function renderErrorState(
  target: TranslationTarget,
  message: string,
  requestId: string
): void {
  if (!inlineRenderer.renderError(target, message)) {
    clearTranslationState(target, "content.response.source_detached", {
      translationRequestId: requestId,
      nextStatus: TRANSLATION_STATUS_ERROR
    });
    return;
  }

  setTranslationState(target, TRANSLATION_STATUS_ERROR, requestId);
}

function renderLoadingState(
  target: TranslationTarget,
  requestId: string
): boolean {
  if (target.mode === "selection") {
    const key = getTargetKey(target);

    if (visibleSelectionBubbleKey && visibleSelectionBubbleKey !== key) {
      clearVisibleSelectionBubble();
    }

    bubbleRenderer.show(target.anchorRect, {
      status: "loading",
      text: ""
    });
    visibleSelectionBubbleKey = key;
    selectionBubbleStates.set(key, {
      status: TRANSLATION_STATUS_LOADING,
      requestId,
      anchorRect: target.anchorRect
    });
    return true;
  }

  clearVisibleSelectionBubble();
  return inlineRenderer.renderLoading(target);
}

function renderSuccessState(
  target: TranslationTarget,
  translatedText: string
): boolean {
  if (target.mode === "selection") {
    const key = getTargetKey(target);

    if (visibleSelectionBubbleKey && visibleSelectionBubbleKey !== key) {
      clearVisibleSelectionBubble();
    }

    bubbleRenderer.show(target.anchorRect, {
      status: "success",
      text: translatedText
    });
    visibleSelectionBubbleKey = key;
    selectionBubbleStates.set(key, {
      status: TRANSLATION_STATUS_SUCCESS,
      text: translatedText,
      anchorRect: target.anchorRect
    });
    return true;
  }

  return inlineRenderer.renderSuccess(target, translatedText);
}

function renderTargetErrorState(
  target: TranslationTarget,
  message: string,
  requestId: string
): void {
  if (target.mode === "selection") {
    const key = getTargetKey(target);

    if (visibleSelectionBubbleKey && visibleSelectionBubbleKey !== key) {
      clearVisibleSelectionBubble();
    }

    bubbleRenderer.show(target.anchorRect, {
      status: "error",
      text: message
    });
    visibleSelectionBubbleKey = key;
    selectionBubbleStates.set(key, {
      status: TRANSLATION_STATUS_ERROR,
      text: message,
      anchorRect: target.anchorRect
    });
    setTranslationState(target, TRANSLATION_STATUS_ERROR, requestId);
    return;
  }

  renderErrorState(target, message, requestId);
}

async function requestTranslation(target: TranslationTarget): Promise<void> {
  const requestId = createRequestId();

  if (!renderLoadingState(target, requestId)) {
    clearTranslationState(target, "content.request.source_missing", {
      translationRequestId: requestId
    });
    return;
  }

  clearOtherSelectionTranslationStates(target);
  setTranslationState(target, TRANSLATION_STATUS_LOADING, requestId);

  let response: ExtensionResponse | undefined;

  try {
    response = await chrome.runtime.sendMessage<
      ExtensionRequest,
      ExtensionResponse
    >({
      type: "TRANSLATE_CURRENT_TARGET",
      requestId,
      target
    });
  } catch {
    if (!isActiveRequest(target, requestId)) {
      logIgnoredResponse(target, requestId, "stale_after_send_error");
      return;
    }

    renderTargetErrorState(target, "번역 요청을 처리하지 못했습니다.", requestId);
    return;
  }

  if (!isActiveRequest(target, requestId)) {
    logIgnoredResponse(target, requestId, "stale_response");
    return;
  }

  if (!hasTargetSourceElement(target)) {
    clearTranslationState(target, "content.response.source_detached", {
      translationRequestId: requestId
    });
    return;
  }

  if (!isTranslationResult(response)) {
    renderTargetErrorState(target, "번역 결과를 받지 못했습니다.", requestId);
    return;
  }

  if (response.requestId !== requestId) {
    renderTargetErrorState(target, "번역 결과를 받지 못했습니다.", requestId);
    return;
  }

  if (!response.ok) {
    renderTargetErrorState(target, response.message, requestId);
    return;
  }

  if (!renderSuccessState(target, response.translatedText)) {
    clearTranslationState(target, "content.response.source_detached", {
      translationRequestId: requestId,
      nextStatus: TRANSLATION_STATUS_SUCCESS
    });
    return;
  }

  setTranslationState(target, TRANSLATION_STATUS_SUCCESS, requestId);
}

async function handleSelectionTranslateTrigger(
  target: TranslationTarget
): Promise<void> {
  const key = getTargetKey(target);
  const trackedState = getTranslationState(target);

  if (trackedState?.status === TRANSLATION_STATUS_LOADING) {
    writeContentDebugEvent("content.request.duplicate_ignored", {
      ...describeTarget(target),
      translationRequestId: trackedState.requestId ?? null
    });
    return;
  }

  if (
    visibleSelectionBubbleKey === key &&
    (trackedState?.status === TRANSLATION_STATUS_SUCCESS ||
      trackedState?.status === TRANSLATION_STATUS_ERROR)
  ) {
    markVisibleSelectionBubbleHidden();
    return;
  }

  if (showHiddenSelectionBubbleIfAvailable(target)) {
    return;
  }

  await requestTranslation(target);
}

async function handleTranslateTrigger(): Promise<void> {
  if (!(await isExtensionEnabled())) {
    return;
  }

  const target = getCurrentTranslationTarget();

  if (!target) {
    return;
  }

  const trackedState = getTranslationState(target);

  if (target.mode === "selection") {
    await handleSelectionTranslateTrigger(target);
    return;
  }

  clearVisibleSelectionBubble();

  const renderedStatus = inlineRenderer.getRenderedStatus(target);

  if (trackedState?.status === TRANSLATION_STATUS_LOADING) {
    if (renderedStatus === TRANSLATION_STATUS_LOADING) {
      writeContentDebugEvent("content.request.duplicate_ignored", {
        ...describeTarget(target),
        translationRequestId: trackedState.requestId ?? null
      });
      return;
    }

    clearTranslationState(target, "content.state.loading_recovered", {
      staleRequestId: trackedState.requestId ?? null,
      renderedStatus: renderedStatus ?? null
    });
  }

  if (
    renderedStatus === TRANSLATION_STATUS_LOADING &&
    trackedState?.status === TRANSLATION_STATUS_LOADING
  ) {
    writeContentDebugEvent("content.request.duplicate_ignored", {
      ...describeTarget(target),
      translationRequestId: trackedState?.requestId ?? null
    });
    return;
  }

  const toggleResult = inlineRenderer.toggleRenderedResult(target);

  if (toggleResult === "hidden") {
    setTranslationState(target, TRANSLATION_STATUS_HIDDEN);
    return;
  }

  if (toggleResult === "shown") {
    setTranslationState(target, TRANSLATION_STATUS_SUCCESS);
    return;
  }

  await requestTranslation(target);
}

hoverTracker.start();
installTranslationTrigger(DEFAULT_TRIGGER_HOTKEY);
void loadStoredTriggerHotkey()
  .then(installTranslationTrigger)
  .catch(() => undefined);
chrome.storage.onChanged.addListener(handleStoredOptionsChanged);

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionRequest,
    _sender,
    sendResponse: (response: ExtensionResponse) => void
  ) => {
    if (message.type !== "PING") {
      sendResponse({
        type: "ERROR",
        message: "Unsupported message type."
      });
      return;
    }

    sendResponse({
      type: "PONG",
      location: window.location.href
    });
  }
);

if (location.hostname === "www.youtube.com" || location.hostname === "youtube.com") {
  startYouTubeSubtitleSession();
}
