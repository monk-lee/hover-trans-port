import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

function fail(message) {
  console.error(`hotkey-check: ${message}`);
  process.exit(1);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(
        actual
      )}`
    );
  }
}

class FakeElement {
  parentElement = null;
  isContentEditable = false;

  constructor(matches = []) {
    this.matches = new Set(matches);
  }

  closest(selector) {
    if (selector === "input, textarea, select") {
      return this.matches.has("input") ||
        this.matches.has("textarea") ||
        this.matches.has("select")
        ? this
        : null;
    }

    return null;
  }
}

global.Element = FakeElement;
global.HTMLElement = FakeElement;

const listeners = new Map();
global.window = {
  addEventListener(type, listener) {
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  },
  removeEventListener(type, listener) {
    listeners.set(
      type,
      (listeners.get(type) ?? []).filter((current) => current !== listener)
    );
  }
};

function transpile(sourcePath) {
  return ts.transpileModule(readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
}

const tempDir = mkdtempSync(join(tmpdir(), "hover-trans-port-hotkey-"));
const tempSharedDir = join(tempDir, "src/shared");
const tempContentDir = join(tempDir, "src/content");
mkdirSync(tempSharedDir, { recursive: true });
mkdirSync(tempContentDir, { recursive: true });
writeFileSync(
  join(tempSharedDir, "hotkeys.js"),
  transpile("src/shared/hotkeys.ts")
);
writeFileSync(
  join(tempContentDir, "leftControlTrigger.js"),
  transpile("src/content/leftControlTrigger.ts").replace(
    "../shared/hotkeys",
    "../shared/hotkeys.js"
  )
);

const moduleUrl = pathToFileURL(
  join(tempContentDir, "leftControlTrigger.js")
).href;
const hotkeysModuleUrl = pathToFileURL(join(tempSharedDir, "hotkeys.js")).href;
const pageTarget = new FakeElement();
const inputTarget = new FakeElement(["input"]);
const {
  installHotkeyTrigger,
  installLeftControlTrigger
} = await import(moduleUrl);
const { DEFAULT_TRIGGER_HOTKEY, formatTriggerHotkey, validateTriggerHotkey } =
  await import(hotkeysModuleUrl);

function installCounter(hotkey) {
  let triggerCount = 0;
  const uninstall = hotkey
    ? installHotkeyTrigger(() => {
        triggerCount += 1;
      }, hotkey)
    : installLeftControlTrigger(() => {
        triggerCount += 1;
      });

  return {
    get triggerCount() {
      return triggerCount;
    },
    uninstall
  };
}

function dispatch(type, init) {
  const event = {
    repeat: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    target: pageTarget,
    preventDefault() {
      this.defaultPrevented = true;
    },
    defaultPrevented: false,
    ...init
  };

  for (const listener of listeners.get(type) ?? []) {
    listener(event);
  }

  return event;
}

let counter = installCounter();

assertEqual(
  formatTriggerHotkey(DEFAULT_TRIGGER_HOTKEY),
  "Left Control",
  "default trigger is left Control"
);

dispatch("keydown", { code: "ControlLeft", ctrlKey: true });
dispatch("keyup", { code: "ControlLeft" });
assertEqual(counter.triggerCount, 1, "left Control alone triggers");

dispatch("keydown", { code: "ControlLeft", ctrlKey: true });
dispatch("keydown", { code: "KeyF", ctrlKey: true });
dispatch("keyup", { code: "ControlLeft" });
assertEqual(counter.triggerCount, 1, "left Control combination does not trigger");

dispatch("keydown", { code: "ControlLeft", ctrlKey: true });
dispatch("keyup", { code: "ControlLeft" });
assertEqual(
  counter.triggerCount,
  2,
  "left Control recovers after a swallowed non-Control keyup"
);

counter.uninstall();
assertEqual((listeners.get("keydown") ?? []).length, 0, "keydown cleanup");
assertEqual((listeners.get("keyup") ?? []).length, 0, "keyup cleanup");

counter = installCounter({
  kind: "modifier",
  code: "ControlRight"
});

dispatch("keydown", { code: "ControlLeft", ctrlKey: true });
dispatch("keyup", { code: "ControlLeft" });
assertEqual(counter.triggerCount, 0, "configured right Control ignores left Control");

dispatch("keydown", { code: "ControlRight", ctrlKey: true });
dispatch("keyup", { code: "ControlRight" });
assertEqual(counter.triggerCount, 1, "configured right Control triggers");
counter.uninstall();

counter = installCounter({
  kind: "combo",
  code: "KeyY",
  ctrlKey: true,
  shiftKey: true,
  altKey: false,
  metaKey: false
});

dispatch("keydown", {
  code: "KeyY",
  key: "Y",
  ctrlKey: true,
  shiftKey: false
});
assertEqual(counter.triggerCount, 0, "combo does not trigger with missing modifier");

const comboEvent = dispatch("keydown", {
  code: "KeyY",
  key: "Y",
  ctrlKey: true,
  shiftKey: true
});
assertEqual(counter.triggerCount, 1, "combo triggers when all modifiers match");
assertEqual(comboEvent.defaultPrevented, true, "combo prevents page default");

dispatch("keydown", {
  code: "KeyY",
  key: "Y",
  ctrlKey: true,
  shiftKey: true,
  target: inputTarget
});
assertEqual(counter.triggerCount, 1, "combo ignores editable targets");
counter.uninstall();

const modifierChordHotkey = {
  kind: "modifierChord",
  codes: ["ControlLeft", "ShiftLeft"]
};

assertEqual(
  validateTriggerHotkey(modifierChordHotkey),
  null,
  "left Control plus left Shift is valid"
);
assertEqual(
  formatTriggerHotkey(modifierChordHotkey),
  "Left Control+Left Shift",
  "modifier chord label is formatted"
);

counter = installCounter(modifierChordHotkey);
dispatch("keydown", { code: "ControlLeft", ctrlKey: true });
dispatch("keydown", { code: "ShiftLeft", ctrlKey: true, shiftKey: true });
dispatch("keyup", { code: "ShiftLeft", ctrlKey: true });
dispatch("keyup", { code: "ControlLeft" });
assertEqual(
  counter.triggerCount,
  1,
  "left Control plus left Shift chord triggers after release"
);

dispatch("keydown", { code: "ControlLeft", ctrlKey: true });
dispatch("keydown", { code: "ShiftLeft", ctrlKey: true, shiftKey: true });
dispatch("keydown", { code: "KeyT", ctrlKey: true, shiftKey: true });
dispatch("keyup", { code: "KeyT", ctrlKey: true, shiftKey: true });
dispatch("keyup", { code: "ShiftLeft", ctrlKey: true });
dispatch("keyup", { code: "ControlLeft" });
assertEqual(
  counter.triggerCount,
  1,
  "modifier chord with an extra key does not trigger"
);
counter.uninstall();

for (const code of ["KeyA", "KeyN", "KeyP", "KeyS", "KeyT", "KeyW"]) {
  assertEqual(
    validateTriggerHotkey({
      kind: "combo",
      code,
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false
    }),
    "That shortcut conflicts with common browser or editing commands.",
    `Control+${code} is rejected`
  );
}

assertEqual(
  validateTriggerHotkey({
    kind: "combo",
    code: "KeyT",
    ctrlKey: true,
    shiftKey: false,
    altKey: true,
    metaKey: false
  }),
  null,
  "Control+Alt+T remains available"
);

console.log("hotkey-check: configurable trigger behavior is present.");
rmSync(tempDir, { recursive: true, force: true });
