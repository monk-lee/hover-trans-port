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
  console.error(`youtube-subtitle-ui-check: ${message}`);
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

  remove() {
    this.parentElement?.removeChild(this);
  }
}

class FakeElement {
  nodeType = 1;
  parentElement = null;
  childNodes = [];
  attributes = new Map();
  dataset = {};
  className = "";
  hidden = false;
  disabled = false;
  onclick = null;
  type = "";

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
    this.replaceChildren(new FakeTextNode(String(text)));
  }

  append(...children) {
    for (const child of children) {
      this.appendChild(child);
    }
  }

  appendChild(child) {
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child, referenceChild) {
    child.parentElement = this;
    const referenceIndex = this.childNodes.indexOf(referenceChild);
    if (referenceIndex < 0) {
      this.childNodes.push(child);
    } else {
      this.childNodes.splice(referenceIndex, 0, child);
    }
    return child;
  }

  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) {
      this.childNodes.splice(index, 1);
      child.parentElement = null;
    }
    return child;
  }

  replaceChildren(...children) {
    this.childNodes = [];
    for (const child of children) {
      this.appendChild(child);
    }
  }

  after(child) {
    if (!this.parentElement) {
      return;
    }
    const index = this.parentElement.childNodes.indexOf(this);
    child.parentElement = this.parentElement;
    this.parentElement.childNodes.splice(index + 1, 0, child);
  }

  remove() {
    this.parentElement?.removeChild(this);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "class") {
      this.className = String(value);
    }
  }

  getAttribute(name) {
    if (name === "class") {
      return this.className;
    }
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "class") {
      this.className = "";
    }
  }

  querySelector(selector) {
    return findElement(this, (element) => element !== this && matchesSelector(element, selector));
  }

  querySelectorAll(selector) {
    const elements = [];
    findElements(this, (element) => {
      if (element !== this && matchesSelector(element, selector)) {
        elements.push(element);
      }
    });
    return elements;
  }
}

class FakeDocument {
  documentElement = new FakeElement("html");
  head = new FakeElement("head");
  body = new FakeElement("body");

  constructor() {
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  createElementNS(_namespace, tagName) {
    return new FakeElement(tagName);
  }

  getElementById(id) {
    return findElement(this.documentElement, (element) => element.getAttribute("id") === id);
  }

  querySelector(selector) {
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
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

function findElements(root, visitor) {
  visitor(root);
  for (const child of root.children) {
    findElements(child, visitor);
  }
}

function matchesSelector(element, selector) {
  if (selector.includes(",")) {
    return selector.split(",").some((part) => matchesSelector(element, part.trim()));
  }

  if (selector.startsWith("#")) {
    return element.getAttribute("id") === selector.slice(1);
  }

  if (selector.startsWith(".")) {
    const className = selector.slice(1);
    return element.className.split(/\s+/g).includes(className);
  }

  const attributeMatch = selector.match(/^\[([^=\]]+)="([^"]*)"\]$/);
  if (attributeMatch) {
    const [, name, value] = attributeMatch;
    return element.getAttribute(name) === value;
  }

  return element.tagName.toLowerCase() === selector.toLowerCase();
}

function findAllControls(root) {
  return root.querySelectorAll(
    '[data-hover-trans-port-youtube-subtitle-control="true"]'
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

global.document = new FakeDocument();
global.HTMLElement = FakeElement;
global.HTMLButtonElement = FakeElement;

const tempDir = mkdtempSync(
  join(tmpdir(), "hover-trans-port-youtube-subtitle-ui-")
);
const tempContentDir = join(tempDir, "src/content");
const tempSharedDir = join(tempDir, "src/shared");
mkdirSync(tempContentDir, { recursive: true });
mkdirSync(tempSharedDir, { recursive: true });
writeFileSync(
  join(tempSharedDir, "youtubeSubtitles.js"),
  transpile("src/shared/youtubeSubtitles.ts")
);
writeFileSync(
  join(tempContentDir, "youtubeSubtitleControl.js"),
  transpile("src/content/youtubeSubtitleControl.ts")
);
writeFileSync(
  join(tempContentDir, "youtubeSubtitleOverlay.js"),
  transpile("src/content/youtubeSubtitleOverlay.ts").replace(
    "../shared/youtubeSubtitles",
    "../shared/youtubeSubtitles.js"
  )
);

try {
  const { YouTubeSubtitleControl } = await import(
    pathToFileURL(join(tempContentDir, "youtubeSubtitleControl.js")).href
  );
  const { YouTubeSubtitleOverlay } = await import(
    pathToFileURL(join(tempContentDir, "youtubeSubtitleOverlay.js")).href
  );

  const controls = document.createElement("div");
  controls.className = "ytp-right-controls-left";
  const subtitleButton = document.createElement("button");
  subtitleButton.className = "ytp-subtitles-button ytp-button";
  const settingsButton = document.createElement("button");
  settingsButton.className = "ytp-settings-button ytp-button";
  controls.appendChild(subtitleButton);
  controls.appendChild(settingsButton);
  document.body.appendChild(controls);

  const events = [];
  const control = new YouTubeSubtitleControl({
    onAccept: () => events.push("accept"),
    onDecline: () => events.push("decline"),
    onToggle: () => events.push("toggle")
  });
  control.mount(controls);
  control.setState({ status: "prompt" });
  assert(
    document.head.textContent.includes("transform: translate(-50%, -50%)"),
    "control icon should be absolutely centered inside the YouTube button"
  );
  assert(
    !controls.children[1].textContent.includes("번"),
    "control should use an icon instead of a text label"
  );
  assert(
    controls.children[1].querySelector("svg"),
    "control should render a multilingual icon"
  );
  const firstIcon = controls.children[1].querySelector("svg");
  control.setState({ status: "prompt" });
  assert(
    controls.children[1].querySelector("svg") === firstIcon,
    "control should not recreate its icon when the visible state is unchanged"
  );
  assert(
    controls.children[1].getAttribute(
      "data-hover-trans-port-youtube-subtitle-control"
    ) === "true",
    "control should mount between subtitle and settings buttons"
  );

  control.setState({ status: "loading", message: "번역 중..." });
  assert(
    controls.children[1].textContent === "",
    "loading state should use the spinner without widening the YouTube control"
  );
  assert(
    controls.children[1].getAttribute("aria-label") === "번역 중...",
    "loading state should keep accessible status text"
  );

  control.setState({
    status: "unavailable",
    message: "사용 가능한 YouTube 자막이 없습니다."
  });
  assert(!controls.children[1].disabled, "unavailable state should remain clickable");
  controls.children[1].onclick();
  assert(
    controls.textContent.includes("사용 가능한 YouTube 자막이 없습니다."),
    "clicking unavailable control should explain why translation cannot start"
  );

  control.mount(controls);
  assert(findAllControls(controls).length === 1, "control mount should be idempotent");

  const player = document.createElement("div");
  player.className = "html5-video-player";
  const captionContainer = document.createElement("div");
  captionContainer.className = "ytp-caption-window-container";
  captionContainer.setAttribute("id", "ytp-caption-window-container");
  const nativeCaption = document.createElement("div");
  nativeCaption.className = "caption-window ytp-caption-window-bottom";
  nativeCaption.textContent = "Hello";
  captionContainer.appendChild(nativeCaption);
  player.appendChild(captionContainer);
  document.body.appendChild(player);

  const overlay = new YouTubeSubtitleOverlay();
  overlay.mount(player);
  assert(
    !document.head.textContent.includes(
      '[data-hover-trans-port-youtube-caption-container="true"] {\n      inset: 0;'
    ),
    "existing YouTube caption containers should not receive fallback positioning CSS"
  );
  overlay.setCues([
    { id: "a", startMs: 0, endMs: 1000, translatedText: "안녕" }
  ]);
  overlay.update(0.5);
  const translatedCaption = captionContainer.querySelector(
    '[data-hover-trans-port-youtube-subtitle-overlay="true"]'
  );
  assert(translatedCaption, "translated captions should mount inside YouTube caption container");
  assert(
    translatedCaption.className.split(/\s+/g).includes("caption-window"),
    "translated captions should use YouTube caption window classes"
  );
  assert(
    captionContainer.getAttribute("data-hover-trans-port-youtube-subtitles-active") === "true",
    "translation should mark the YouTube caption container active"
  );
  assert(captionContainer.textContent.includes("안녕"), "overlay should show active cue");
  overlay.mount(player);
  assert(
    captionContainer.textContent.includes("안녕"),
    "overlay remount should not clear an active translated cue"
  );
  overlay.update(2);
  assert(
    !captionContainer.textContent.includes("안녕"),
    "overlay should hide inactive cue"
  );
  overlay.clear();
  assert(
    captionContainer.getAttribute("data-hover-trans-port-youtube-subtitles-active") === null,
    "clearing translation should restore the YouTube caption container"
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
