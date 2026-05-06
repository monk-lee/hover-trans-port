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

const SOURCE_KEY_ATTRIBUTE = "data-hover-trans-port-source-key";
const INLINE_ATTRIBUTE = "data-hover-trans-port-inline";

function fail(message) {
  console.error(`inline-renderer-check: ${message}`);
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

class FakeDocumentFragment {
  childNodes = [];

  appendChild(child) {
    this.childNodes.push(child);
    return child;
  }
}

class FakeElement {
  nodeType = 1;
  parentElement = null;
  childNodes = [];
  attributes = new Map();
  className = "";
  hidden = false;
  lang = "";
  styleDisplay = "block";
  styleOverflow = "visible";
  styleOverflowX = "visible";
  styleOverflowY = "visible";
  styleWebkitLineClamp = "none";

  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
  }

  get children() {
    return this.childNodes.filter((node) => node instanceof FakeElement);
  }

  get textContent() {
    return this.childNodes
      .map((node) => node.textContent ?? "")
      .join("");
  }

  set textContent(text) {
    this.replaceChildren(new FakeTextNode(text));
  }

  appendChild(child) {
    if (child instanceof FakeDocumentFragment) {
      for (const fragmentChild of child.childNodes) {
        this.appendChild(fragmentChild);
      }
      child.childNodes = [];
      return child;
    }

    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child, referenceChild) {
    if (child instanceof FakeDocumentFragment) {
      for (const fragmentChild of child.childNodes) {
        this.insertBefore(fragmentChild, referenceChild);
      }
      child.childNodes = [];
      return child;
    }

    const referenceIndex =
      referenceChild === null ? -1 : this.childNodes.indexOf(referenceChild);

    child.parentElement = this;

    if (referenceIndex < 0) {
      this.childNodes.push(child);
    } else {
      this.childNodes.splice(referenceIndex, 0, child);
    }

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

  removeAttribute(name) {
    this.attributes.delete(name);
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

  createDocumentFragment() {
    return new FakeDocumentFragment();
  }

  getElementById(id) {
    return findElement(this.documentElement, (element) => element.getAttribute("id") === id);
  }

  querySelector(selector) {
    return findElement(this.documentElement, (element) => matchesSelector(element, selector));
  }
}

function findElement(root, predicate) {
  if (predicate(root)) {
    return root;
  }

  for (const child of root.children) {
    const match = findElement(child, predicate);

    if (match) {
      return match;
    }
  }

  return null;
}

function matchesSelector(element, selector) {
  const attributeMatches = [...selector.matchAll(/\[([^=\]]+)="([^"]*)"\]/g)];

  return (
    attributeMatches.length > 0 &&
    attributeMatches.every(([, name, value]) => element.getAttribute(name) === value)
  );
}

function transpile(sourcePath) {
  return ts.transpileModule(readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
}

function inlineNodesUnder(element) {
  const nodes = [];

  findElement(element, (node) => {
    if (node.getAttribute(INLINE_ATTRIBUTE) === "true") {
      nodes.push(node);
    }

    return false;
  });

  return nodes;
}

const tempDir = mkdtempSync(join(tmpdir(), "hover-trans-port-inline-renderer-"));
const tempContentDir = join(tempDir, "src/content");
mkdirSync(tempContentDir, { recursive: true });
writeFileSync(
  join(tempContentDir, "inlineRenderer.js"),
  transpile("src/content/inlineRenderer.ts")
    .replace("./inlineMarkerRenderer", "./inlineMarkerRenderer.js")
    .replace("./sourceElement", "./sourceElement.js")
);
writeFileSync(
  join(tempContentDir, "inlineMarkerRenderer.js"),
  transpile("src/content/inlineMarkerRenderer.ts")
);
writeFileSync(
  join(tempContentDir, "sourceElement.js"),
  `
  export function findSourceElementByOwnerKey(ownerKey) {
    return document.querySelector('[${SOURCE_KEY_ATTRIBUTE}="' + CSS.escape(ownerKey) + '"]');
  }
  `
);

global.CSS = {
  escape(value) {
    return String(value);
  }
};
global.HTMLElement = FakeElement;
global.document = new FakeDocument();
global.window = {
  getComputedStyle(element) {
    return {
      display: element.styleDisplay,
      overflow: element.styleOverflow,
      overflowX: element.styleOverflowX,
      overflowY: element.styleOverflowY,
      visibility: "visible",
      webkitLineClamp: element.styleWebkitLineClamp,
      getPropertyValue(property) {
        return property === "-webkit-line-clamp"
          ? element.styleWebkitLineClamp
          : "";
      }
    };
  }
};

try {
  const { InlineRenderer } = await import(
    pathToFileURL(join(tempContentDir, "inlineRenderer.js")).href
  );

  const target = {
    mode: "hover-block",
    text: "Secret scanning with GitHub MCP Server is now generally available",
    anchorRect: { top: 0, left: 0, width: 320, height: 40 },
    pageUrl: "https://github.com/dashboard/changelog",
    pageTitle: "GitHub",
    sourceElement: {
      ownerKey: "hover-trans-port-source-1",
      tagName: "li",
      renderStrategy: "inside-source"
    }
  };

  const source = document.createElement("li");
  source.styleDisplay = "flex";
  source.setAttribute(SOURCE_KEY_ATTRIBUTE, target.sourceElement.ownerKey);
  document.body.appendChild(source);

  const badge = document.createElement("div");
  const body = document.createElement("div");
  body.appendChild(document.createTextNode("May 6, 2026"));
  body.appendChild(document.createTextNode("Secret scanning with GitHub MCP Server is now generally available"));
  source.appendChild(badge);
  source.appendChild(body);

  const renderer = new InlineRenderer();
  assert(renderer.renderSuccess(target, "2026년 5월 6일 GitHub MCP Server를 사용한 시크릿 스캐닝이 이제 일반적으로 제공됩니다"), "render should succeed");
  assert(inlineNodesUnder(body).length === 1, "flex layout translation should be inserted into the text-bearing child");
  assert(
    source.children.filter((child) => child.getAttribute(INLINE_ATTRIBUTE) === "true").length === 0,
    "flex layout translation should not be inserted as a source-level flex item"
  );

  const paragraphTarget = {
    ...target,
    sourceElement: {
      ownerKey: "hover-trans-port-source-2",
      tagName: "p",
      renderStrategy: "inside-source"
    }
  };
  const paragraph = document.createElement("p");
  paragraph.setAttribute(SOURCE_KEY_ATTRIBUTE, paragraphTarget.sourceElement.ownerKey);
  paragraph.appendChild(document.createTextNode("Standalone paragraph"));
  document.body.appendChild(paragraph);

  assert(renderer.renderSuccess(paragraphTarget, "독립 문단"), "paragraph render should succeed");
  assert(inlineNodesUnder(paragraph).length === 1, "normal block translation should remain inside the source element");

  const clampedTarget = {
    ...target,
    sourceElement: {
      ownerKey: "hover-trans-port-source-3",
      tagName: "p",
      renderStrategy: "inside-source"
    }
  };
  const clampedContainer = document.createElement("div");
  const clampedParagraph = document.createElement("p");
  clampedParagraph.styleDisplay = "-webkit-box";
  clampedParagraph.styleOverflow = "hidden";
  clampedParagraph.styleWebkitLineClamp = "2";
  clampedParagraph.setAttribute(SOURCE_KEY_ATTRIBUTE, clampedTarget.sourceElement.ownerKey);
  clampedParagraph.appendChild(document.createTextNode("A long clamped paragraph"));
  clampedContainer.appendChild(clampedParagraph);
  document.body.appendChild(clampedContainer);

  assert(renderer.renderSuccess(clampedTarget, "잘리지 않는 번역문"), "clamped render should succeed");
  assert(
    inlineNodesUnder(clampedParagraph).length === 0,
    "clipped source translation should not be inserted inside the clipped source"
  );
  assert(
    clampedContainer.children[1]?.getAttribute(INLINE_ATTRIBUTE) === "true",
    "clipped source translation should be inserted after the clipped source"
  );

  console.log("inline-renderer-check: inline insertion behavior is valid.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
