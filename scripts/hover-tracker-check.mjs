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
  console.error(`hover-tracker-check: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

class FakeTextNode {
  nodeType = 3;
  parentElement = null;

  constructor(text) {
    this.textContent = text;
  }
}

class FakeElement {
  nodeType = 1;
  parentElement = null;
  childNodes = [];
  attributes = new Map();
  rect = { width: 100, height: 20 };
  styleDisplay = "block";
  styleVisibility = "visible";

  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
  }

  get children() {
    return this.childNodes.filter((node) => node instanceof FakeElement);
  }

  get textContent() {
    return this.childNodes.map((node) => node.textContent ?? "").join("");
  }

  set textContent(text) {
    this.replaceChildren(new FakeTextNode(text));
  }

  appendChild(child) {
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.childNodes = [];

    for (const child of children) {
      this.appendChild(child);
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  matches(selector) {
    return selector.split(",").some((part) => matchesSimpleSelector(this, part.trim()));
  }

  closest(selector) {
    let current = this;

    while (current) {
      if (current.matches(selector)) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  querySelector(selector) {
    return findElement(this, (element) => element !== this && element.matches(selector));
  }

  getBoundingClientRect() {
    return {
      top: 0,
      left: 0,
      width: this.rect.width,
      height: this.rect.height
    };
  }
}

class FakeDocument {
  documentElement = new FakeElement("html");
  body = new FakeElement("body");
  listeners = new Map();

  constructor() {
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  createTextNode(text) {
    return new FakeTextNode(text);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type, listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((current) => current !== listener)
    );
  }

  dispatch(type, target) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ target });
    }
  }
}

function findElement(root, predicate) {
  for (const child of root.children) {
    if (predicate(child)) {
      return child;
    }

    const match = findElement(child, predicate);

    if (match) {
      return match;
    }
  }

  return null;
}

function matchesSimpleSelector(element, selector) {
  if (!selector) {
    return false;
  }

  if (selector.startsWith("[")) {
    const attributeMatch = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);

    if (!attributeMatch) {
      return false;
    }

    const [, name, value] = attributeMatch;
    const actualValue = element.getAttribute(name);

    return value === undefined ? actualValue !== null : actualValue === value;
  }

  return element.tagName.toLowerCase() === selector.toLowerCase();
}

function transpile(sourcePath) {
  return ts.transpileModule(readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
}

const tempDir = mkdtempSync(join(tmpdir(), "hover-trans-port-hover-tracker-"));
const tempContentDir = join(tempDir, "src/content");
mkdirSync(tempContentDir, { recursive: true });
writeFileSync(
  join(tempContentDir, "translatableElement.js"),
  transpile("src/content/translatableElement.ts")
);
writeFileSync(
  join(tempContentDir, "hoverTracker.js"),
  transpile("src/content/hoverTracker.ts").replace(
    "./translatableElement",
    "./translatableElement.js"
  )
);

global.Node = {
  ELEMENT_NODE: 1,
  TEXT_NODE: 3
};
global.Element = FakeElement;
global.HTMLElement = FakeElement;
global.document = new FakeDocument();
global.window = {
  getComputedStyle(element) {
    return {
      display: element.styleDisplay,
      visibility: element.styleVisibility
    };
  }
};

try {
  const { HoverTracker } = await import(
    pathToFileURL(join(tempContentDir, "hoverTracker.js")).href
  );

  const paragraph = document.createElement("p");
  paragraph.textContent = "This sentence should be translatable.";

  const input = document.createElement("input");
  input.textContent = "ignored";

  document.body.appendChild(paragraph);
  document.body.appendChild(input);

  const tracker = new HoverTracker();
  tracker.start();

  assert(
    (document.listeners.get("mouseover") ?? []).length === 1,
    "tracker should listen to mouseover"
  );
  assert(
    (document.listeners.get("mousemove") ?? []).length === 1,
    "tracker should listen to mousemove"
  );

  document.dispatch("mousemove", paragraph);
  assert(
    tracker.getCurrentElement() === paragraph,
    "mousemove should update the current translatable element"
  );

  document.dispatch("mousemove", input);
  assert(
    tracker.getCurrentElement() === null,
    "mousemove over form controls should clear the current element"
  );

  document.dispatch("mouseover", paragraph);
  assert(
    tracker.getCurrentElement() === paragraph,
    "mouseover should still update the current translatable element"
  );

  tracker.stop();
  assert(
    (document.listeners.get("mouseover") ?? []).length === 0,
    "tracker should remove mouseover listener"
  );
  assert(
    (document.listeners.get("mousemove") ?? []).length === 0,
    "tracker should remove mousemove listener"
  );

  console.log("hover-tracker-check: mousemove hover target tracking is present.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
