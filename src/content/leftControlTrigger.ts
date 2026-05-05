import type { TriggerHotkey } from "../shared/hotkeys";

const DEFAULT_TRIGGER_HOTKEY: TriggerHotkey = {
  kind: "modifier",
  code: "ControlLeft"
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  if (target.closest("input, textarea, select")) {
    return true;
  }

  let current: Element | null = target;

  while (current) {
    if (current instanceof HTMLElement && current.isContentEditable) {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

function isTargetModifierPressed(
  event: KeyboardEvent,
  targetCode: string
): boolean {
  if (targetCode.startsWith("Control")) {
    return event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
  }

  if (targetCode.startsWith("Alt")) {
    return event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey;
  }

  if (targetCode.startsWith("Shift")) {
    return event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
  }

  return false;
}

function matchesComboHotkey(
  event: KeyboardEvent,
  hotkey: Extract<TriggerHotkey, { kind: "combo" }>
): boolean {
  return (
    event.code === hotkey.code &&
    event.ctrlKey === hotkey.ctrlKey &&
    event.shiftKey === hotkey.shiftKey &&
    event.altKey === hotkey.altKey &&
    event.metaKey === hotkey.metaKey
  );
}

function installModifierTrigger(
  onTrigger: () => void,
  hotkey: Extract<TriggerHotkey, { kind: "modifier" }>
): () => void {
  const pressedNonTargetKeys = new Set<string>();
  let isTrackingTarget = false;
  let isCanceled = false;

  const resetTracking = (): void => {
    pressedNonTargetKeys.clear();
    isTrackingTarget = false;
    isCanceled = false;
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) {
      resetTracking();
      return;
    }

    if (event.code === hotkey.code) {
      if (event.repeat) {
        return;
      }

      if (
        !isTargetModifierPressed(event, hotkey.code) ||
        pressedNonTargetKeys.size > 0
      ) {
        isTrackingTarget = false;
        isCanceled = true;
        return;
      }

      isTrackingTarget = true;
      isCanceled = false;
      return;
    }

    if (event.code !== hotkey.code) {
      pressedNonTargetKeys.add(event.code);
    }

    if (isTrackingTarget) {
      isCanceled = true;
    }
  };

  const handleKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== hotkey.code) {
      pressedNonTargetKeys.delete(event.code);
      return;
    }

    if (isEditableTarget(event.target)) {
      isTrackingTarget = false;
      isCanceled = false;
      return;
    }

    const shouldTrigger = isTrackingTarget && !isCanceled;

    pressedNonTargetKeys.clear();
    isTrackingTarget = false;
    isCanceled = false;

    if (shouldTrigger) {
      onTrigger();
    }
  };

  const handleBlur = (): void => {
    resetTracking();
  };

  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("keyup", handleKeyUp, true);
  window.addEventListener("blur", handleBlur, true);

  return () => {
    window.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("keyup", handleKeyUp, true);
    window.removeEventListener("blur", handleBlur, true);
  };
}

function installModifierChordTrigger(
  onTrigger: () => void,
  hotkey: Extract<TriggerHotkey, { kind: "modifierChord" }>
): () => void {
  const targetCodes = new Set<string>(hotkey.codes);
  const pressedTargetCodes = new Set<string>();
  const pressedNonTargetKeys = new Set<string>();
  let isChordComplete = false;
  let isCanceled = false;

  const resetTracking = (): void => {
    pressedTargetCodes.clear();
    pressedNonTargetKeys.clear();
    isChordComplete = false;
    isCanceled = false;
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) {
      resetTracking();
      return;
    }

    if (event.repeat) {
      return;
    }

    if (targetCodes.has(event.code)) {
      if (pressedNonTargetKeys.size > 0) {
        isCanceled = true;
        return;
      }

      pressedTargetCodes.add(event.code);

      if (pressedTargetCodes.size === targetCodes.size) {
        isChordComplete = true;
      }

      return;
    }

    pressedNonTargetKeys.add(event.code);

    if (pressedTargetCodes.size > 0) {
      isCanceled = true;
    }
  };

  const handleKeyUp = (event: KeyboardEvent): void => {
    if (!targetCodes.has(event.code)) {
      pressedNonTargetKeys.delete(event.code);
      return;
    }

    if (isEditableTarget(event.target)) {
      resetTracking();
      return;
    }

    pressedTargetCodes.delete(event.code);

    if (pressedTargetCodes.size > 0) {
      return;
    }

    const shouldTrigger =
      isChordComplete && !isCanceled && pressedNonTargetKeys.size === 0;

    resetTracking();

    if (shouldTrigger) {
      onTrigger();
    }
  };

  const handleBlur = (): void => {
    resetTracking();
  };

  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("keyup", handleKeyUp, true);
  window.addEventListener("blur", handleBlur, true);

  return () => {
    window.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("keyup", handleKeyUp, true);
    window.removeEventListener("blur", handleBlur, true);
  };
}

function installComboTrigger(
  onTrigger: () => void,
  hotkey: Extract<TriggerHotkey, { kind: "combo" }>
): () => void {
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target) || event.repeat) {
      return;
    }

    if (!matchesComboHotkey(event, hotkey)) {
      return;
    }

    event.preventDefault();
    onTrigger();
  };

  window.addEventListener("keydown", handleKeyDown, true);

  return () => {
    window.removeEventListener("keydown", handleKeyDown, true);
  };
}

export function installHotkeyTrigger(
  onTrigger: () => void,
  hotkey: TriggerHotkey = DEFAULT_TRIGGER_HOTKEY
): () => void {
  if (hotkey.kind === "combo") {
    return installComboTrigger(onTrigger, hotkey);
  }

  if (hotkey.kind === "modifierChord") {
    return installModifierChordTrigger(onTrigger, hotkey);
  }

  return installModifierTrigger(onTrigger, hotkey);
}

export function installLeftControlTrigger(onTrigger: () => void): () => void {
  return installHotkeyTrigger(onTrigger, DEFAULT_TRIGGER_HOTKEY);
}
