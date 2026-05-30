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
  console.error(`translatable-element-check: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
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
  styleDisplay = "block";
  styleVisibility = "visible";
  rect = { width: 100, height: 20 };

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
    return matchesSelectorList(this, selector);
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

  constructor() {
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  createTextNode(text) {
    return new FakeTextNode(text);
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

function matchesSelectorList(element, selector) {
  return selector.split(",").some((part) => matchesSimpleSelector(element, part.trim()));
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

const tempDir = mkdtempSync(join(tmpdir(), "hover-trans-port-translatable-element-"));
const tempContentDir = join(tempDir, "src/content");
mkdirSync(tempContentDir, { recursive: true });
writeFileSync(
  join(tempContentDir, "translatableElement.js"),
  transpile("src/content/translatableElement.ts")
);

global.Node = {
  ELEMENT_NODE: 1,
  TEXT_NODE: 3
};
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
  const { findNearestTranslatableElement } = await import(
    pathToFileURL(join(tempContentDir, "translatableElement.js")).href
  );

  const tooltip = document.createElement("div");
  tooltip.setAttribute("data-side", "right");
  tooltip.setAttribute("data-align", "center");
  tooltip.setAttribute("data-state", "delayed-open");

  const visibleText = document.createElement("span");
  visibleText.appendChild(
    document.createTextNode("Your credit balance will be consumed as you use the API. Visit the ")
  );

  const usageLink = document.createElement("a");
  usageLink.textContent = "usage page";
  visibleText.appendChild(usageLink);
  visibleText.appendChild(
    document.createTextNode(" to view a breakdown of your consumption.")
  );

  const hiddenA11yTooltip = document.createElement("span");
  hiddenA11yTooltip.setAttribute("role", "tooltip");
  hiddenA11yTooltip.rect = { width: 1, height: 1 };
  hiddenA11yTooltip.textContent =
    "Your credit balance will be consumed as you use the API. Visit the usage page to view a breakdown of your consumption.";

  tooltip.appendChild(visibleText);
  tooltip.appendChild(hiddenA11yTooltip);
  document.body.appendChild(tooltip);

  const target = findNearestTranslatableElement(usageLink);

  assert(target === visibleText, "inline tooltip text should be detected from a nested link");
  assert(
    normalizeText(target.textContent) ===
      "Your credit balance will be consumed as you use the API. Visit the usage page to view a breakdown of your consumption.",
    "tooltip target should be the visible inline text, without duplicated hidden tooltip text"
  );

  const formRow = document.createElement("div");
  const lastNameLabel = document.createElement("label");
  lastNameLabel.setAttribute("for", "bill_to_surname");
  lastNameLabel.textContent = "Last Name *";

  const lastNameInput = document.createElement("input");
  lastNameInput.setAttribute("id", "bill_to_surname");
  lastNameInput.setAttribute("name", "bill_to_surname");
  formRow.appendChild(lastNameLabel);
  formRow.appendChild(lastNameInput);
  document.body.appendChild(formRow);

  const labelTarget = findNearestTranslatableElement(lastNameLabel);

  assert(labelTarget === lastNameLabel, "form label text should be detected");
  assert(
    normalizeText(labelTarget.textContent) === "Last Name *",
    "form label target should contain only the visible label text"
  );

  assert(
    findNearestTranslatableElement(lastNameInput) === null,
    "form input hover should not translate the associated form row or label"
  );

  const customLabel = document.createElement("field-label");
  customLabel.textContent = "Billing Address";
  document.body.appendChild(customLabel);

  assert(
    findNearestTranslatableElement(customLabel) === customLabel,
    "custom direct text elements should be detected without tag-specific allowlisting"
  );

  const actionButton = document.createElement("button");
  actionButton.textContent = "Continue";
  document.body.appendChild(actionButton);

  assert(
    findNearestTranslatableElement(actionButton) === actionButton,
    "direct text controls should be detected without tag-specific allowlisting"
  );

  const paragraph = document.createElement("p");
  const sentenceSpan = document.createElement("span");
  sentenceSpan.textContent = "Translate the whole paragraph sentence.";
  paragraph.appendChild(sentenceSpan);
  document.body.appendChild(paragraph);

  assert(
    findNearestTranslatableElement(sentenceSpan) === paragraph,
    "inline text inside a semantic block should defer to the readable ancestor"
  );

  console.log("translatable-element-check: detection behavior is valid.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
