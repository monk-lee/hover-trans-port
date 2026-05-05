export const MODIFIER_TRIGGER_CODES = [
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight"
] as const;

export type ModifierTriggerCode = (typeof MODIFIER_TRIGGER_CODES)[number];

export type TriggerHotkey =
  | {
      kind: "modifier";
      code: ModifierTriggerCode;
    }
  | {
      kind: "modifierChord";
      codes: [ModifierTriggerCode, ModifierTriggerCode, ...ModifierTriggerCode[]];
    }
  | {
      kind: "combo";
      code: string;
      ctrlKey: boolean;
      shiftKey: boolean;
      altKey: boolean;
      metaKey: boolean;
    };

export const DEFAULT_TRIGGER_HOTKEY: TriggerHotkey = {
  kind: "modifier",
  code: "ControlLeft"
};

const MODIFIER_CODE_LABELS: Record<ModifierTriggerCode, string> = {
  ControlLeft: "Left Control",
  ControlRight: "Right Control",
  AltLeft: "Left Alt",
  AltRight: "Right Alt",
  ShiftLeft: "Left Shift",
  ShiftRight: "Right Shift"
};

const MODIFIER_CODE_ORDER: Record<ModifierTriggerCode, number> = {
  ControlLeft: 0,
  ControlRight: 1,
  AltLeft: 2,
  AltRight: 3,
  ShiftLeft: 4,
  ShiftRight: 5
};

const SPECIAL_KEY_LABELS: Record<string, string> = {
  Backquote: "`",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Equal: "=",
  Minus: "-",
  Period: ".",
  Quote: "'",
  Semicolon: ";",
  Slash: "/",
  Space: "Space",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  Delete: "Delete",
  Backspace: "Backspace",
  Home: "Home",
  End: "End",
  PageDown: "Page Down",
  PageUp: "Page Up"
};

const RESERVED_COMBO_CODES = new Set([
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

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isModifierTriggerCode(
  code: unknown
): code is ModifierTriggerCode {
  return (
    typeof code === "string" &&
    MODIFIER_TRIGGER_CODES.includes(code as ModifierTriggerCode)
  );
}

function isModifierKeyboardCode(code: string): boolean {
  return (
    isModifierTriggerCode(code) ||
    code === "MetaLeft" ||
    code === "MetaRight" ||
    code === "Control" ||
    code === "Alt" ||
    code === "Shift" ||
    code === "Meta"
  );
}

function getModifierFamily(code: ModifierTriggerCode): string {
  if (code.startsWith("Control")) {
    return "Control";
  }

  if (code.startsWith("Alt")) {
    return "Alt";
  }

  return "Shift";
}

function hasAnyModifier(hotkey: Extract<TriggerHotkey, { kind: "combo" }>) {
  return hotkey.ctrlKey || hotkey.shiftKey || hotkey.altKey || hotkey.metaKey;
}

function normalizeModifierChordCodes(
  codes: unknown
): Array<ModifierTriggerCode> {
  if (!Array.isArray(codes)) {
    return [];
  }

  return Array.from(new Set(codes.filter(isModifierTriggerCode))).sort(
    (left, right) => MODIFIER_CODE_ORDER[left] - MODIFIER_CODE_ORDER[right]
  );
}

export function normalizeTriggerHotkey(value: unknown): TriggerHotkey {
  if (!isObject(value)) {
    return DEFAULT_TRIGGER_HOTKEY;
  }

  if (value.kind === "modifier" && isModifierTriggerCode(value.code)) {
    return {
      kind: "modifier",
      code: value.code
    };
  }

  if (value.kind === "modifierChord") {
    const codes = normalizeModifierChordCodes(value.codes);

    if (codes.length >= 2) {
      const hotkey: TriggerHotkey = {
        kind: "modifierChord",
        codes: codes as [
          ModifierTriggerCode,
          ModifierTriggerCode,
          ...ModifierTriggerCode[]
        ]
      };

      return validateTriggerHotkey(hotkey) ? DEFAULT_TRIGGER_HOTKEY : hotkey;
    }
  }

  if (
    value.kind === "combo" &&
    typeof value.code === "string" &&
    typeof value.ctrlKey === "boolean" &&
    typeof value.shiftKey === "boolean" &&
    typeof value.altKey === "boolean" &&
    typeof value.metaKey === "boolean"
  ) {
    const hotkey: TriggerHotkey = {
      kind: "combo",
      code: value.code,
      ctrlKey: value.ctrlKey,
      shiftKey: value.shiftKey,
      altKey: value.altKey,
      metaKey: value.metaKey
    };

    return validateTriggerHotkey(hotkey) ? DEFAULT_TRIGGER_HOTKEY : hotkey;
  }

  return DEFAULT_TRIGGER_HOTKEY;
}

export function createModifierChordHotkeyFromCodes(
  codes: Iterable<string>
): Extract<TriggerHotkey, { kind: "modifierChord" }> | null {
  const normalizedCodes = normalizeModifierChordCodes(Array.from(codes));

  if (normalizedCodes.length < 2) {
    return null;
  }

  const hotkey: Extract<TriggerHotkey, { kind: "modifierChord" }> = {
    kind: "modifierChord",
    codes: normalizedCodes as [
      ModifierTriggerCode,
      ModifierTriggerCode,
      ...ModifierTriggerCode[]
    ]
  };

  return validateTriggerHotkey(hotkey) ? null : hotkey;
}

export function createModifierHotkeyFromCode(
  code: string
): Extract<TriggerHotkey, { kind: "modifier" }> | null {
  if (!isModifierTriggerCode(code)) {
    return null;
  }

  return {
    kind: "modifier",
    code
  };
}

export function createComboHotkeyFromEvent(
  event: Pick<
    KeyboardEvent,
    "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey"
  >
): TriggerHotkey | null {
  if (!event.code || isModifierKeyboardCode(event.code)) {
    return null;
  }

  return {
    kind: "combo",
    code: event.code,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey
  };
}

export function validateTriggerHotkey(hotkey: TriggerHotkey): string | null {
  if (hotkey.kind === "modifier") {
    return isModifierTriggerCode(hotkey.code)
      ? null
      : "Choose Control, Alt, or Shift.";
  }

  if (hotkey.kind === "modifierChord") {
    const codes = normalizeModifierChordCodes(hotkey.codes);

    if (codes.length < 2) {
      return "Use at least two modifier keys.";
    }

    if (codes.length !== hotkey.codes.length) {
      return "Choose Control, Alt, or Shift.";
    }

    const families = new Set(codes.map(getModifierFamily));

    if (families.size !== codes.length) {
      return "Use different modifier keys.";
    }

    return null;
  }

  if (!hotkey.code || isModifierKeyboardCode(hotkey.code)) {
    return "Press a non-modifier key with at least one modifier.";
  }

  if (!hasAnyModifier(hotkey)) {
    return "Use at least one modifier with this key.";
  }

  if (
    RESERVED_COMBO_CODES.has(hotkey.code) &&
    (hotkey.ctrlKey || hotkey.metaKey) &&
    !hotkey.altKey
  ) {
    return "That shortcut conflicts with common browser or editing commands.";
  }

  return null;
}

function formatKeyCode(code: string): string {
  if (code.startsWith("Key") && code.length === 4) {
    return code.slice(3);
  }

  if (code.startsWith("Digit") && code.length === 6) {
    return code.slice(5);
  }

  if (/^F\d{1,2}$/u.test(code)) {
    return code;
  }

  return SPECIAL_KEY_LABELS[code] ?? code;
}

export function formatTriggerHotkey(hotkey: TriggerHotkey): string {
  if (hotkey.kind === "modifier") {
    return MODIFIER_CODE_LABELS[hotkey.code];
  }

  if (hotkey.kind === "modifierChord") {
    return hotkey.codes.map((code) => MODIFIER_CODE_LABELS[code]).join("+");
  }

  return [
    hotkey.metaKey ? "Command" : "",
    hotkey.ctrlKey ? "Control" : "",
    hotkey.altKey ? "Alt" : "",
    hotkey.shiftKey ? "Shift" : "",
    formatKeyCode(hotkey.code)
  ]
    .filter(Boolean)
    .join("+");
}
