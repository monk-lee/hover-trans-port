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
  console.error(`youtube-subtitle-session-check: ${message}`);
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

  addEventListener() {}

  removeEventListener() {}

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

class FakeVideoElement extends FakeElement {
  currentTime = 0;
  paused = false;

  constructor() {
    super("video");
  }

  pause() {
    this.paused = true;
  }

  async play() {
    this.paused = false;
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
    return tagName === "video" ? new FakeVideoElement() : new FakeElement(tagName);
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

function transpile(sourcePath, replacements = []) {
  let output = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;

  for (const [from, to] of replacements) {
    output = output.replaceAll(from, to);
  }

  return output;
}

global.document = new FakeDocument();
global.HTMLElement = FakeElement;
global.HTMLButtonElement = FakeElement;
global.HTMLVideoElement = FakeVideoElement;
global.location = {
  href: "https://www.youtube.com/watch?v=abc123",
  hostname: "www.youtube.com"
};
global.window = {
  addEventListener() {},
  removeEventListener() {}
};
Object.defineProperty(global, "navigator", {
  value: { language: "en-US" },
  configurable: true
});
global.MutationObserver = class {
  observe() {}
  disconnect() {}
};

const controls = document.createElement("div");
controls.className = "ytp-right-controls-left";
const subtitleButton = document.createElement("button");
subtitleButton.className = "ytp-subtitles-button ytp-button";
const settingsButton = document.createElement("button");
settingsButton.className = "ytp-settings-button ytp-button";
controls.appendChild(subtitleButton);
controls.appendChild(settingsButton);
document.body.appendChild(controls);

const player = document.createElement("div");
player.className = "html5-video-player";
const video = document.createElement("video");
player.appendChild(video);
document.body.appendChild(player);

const sentMessages = [];
global.chrome = {
  runtime: {
    sendMessage(message) {
      sentMessages.push(message);
      if (message.type === "GET_SUBTITLE_TRANSLATION_CACHE") {
        return Promise.resolve({
          type: "SUBTITLE_TRANSLATION_CACHE_RESULT",
          requestId: message.requestId,
          ok: true,
          cached: false
        });
      }
      if (message.type === "TRANSLATE_SUBTITLE_TRACK") {
        return Promise.resolve({
          type: "SUBTITLE_TRANSLATION_RESULT",
          requestId: message.requestId,
          ok: true,
          provider: "codex",
          cached: false,
          elapsedMs: 10,
          cues: [
            { id: "cue-0", startMs: 0, endMs: 1000, translatedText: "안녕" }
          ]
        });
      }
      return Promise.resolve({ type: "ERROR", message: "unexpected" });
    }
  },
  storage: {
    local: {
      get() {
        return Promise.resolve({
          hoverTransPort: {
            provider: "codex",
            targetLang: "Korean",
            cacheEnabled: true,
            timeoutMs: 30000
          }
        });
      }
    }
  }
};

const playerResponseFixture = {
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: "https://www.youtube.com/api/timedtext?v=abc123&lang=en",
          languageCode: "en",
          name: { simpleText: "English" },
          vssId: ".en"
        }
      ]
    }
  }
};

const tempDir = mkdtempSync(
  join(tmpdir(), "hover-trans-port-youtube-subtitle-session-")
);
const tempContentDir = join(tempDir, "src/content");
const tempSharedDir = join(tempDir, "src/shared");
mkdirSync(tempContentDir, { recursive: true });
mkdirSync(tempSharedDir, { recursive: true });

writeFileSync(join(tempSharedDir, "providers.js"), transpile("src/shared/providers.ts"));
writeFileSync(
  join(tempSharedDir, "hotkeys.js"),
  transpile("src/shared/hotkeys.ts")
);
writeFileSync(
  join(tempSharedDir, "options.js"),
  transpile("src/shared/options.ts", [
    ["./providers", "./providers.js"],
    ["./hotkeys", "./hotkeys.js"]
  ])
);
writeFileSync(
  join(tempSharedDir, "youtubeSubtitles.js"),
  transpile("src/shared/youtubeSubtitles.ts")
);
writeFileSync(
  join(tempContentDir, "youtubeCaptionTracks.js"),
  transpile("src/content/youtubeCaptionTracks.ts", [
    ["../shared/youtubeSubtitles", "../shared/youtubeSubtitles.js"]
  ])
);
writeFileSync(
  join(tempContentDir, "youtubeTranscriptFetch.js"),
  transpile("src/content/youtubeTranscriptFetch.ts", [
    ["../shared/youtubeSubtitles", "../shared/youtubeSubtitles.js"]
  ])
);
writeFileSync(
  join(tempContentDir, "youtubeSubtitleControl.js"),
  transpile("src/content/youtubeSubtitleControl.ts")
);
writeFileSync(
  join(tempContentDir, "youtubeSubtitleOverlay.js"),
  transpile("src/content/youtubeSubtitleOverlay.ts", [
    ["../shared/youtubeSubtitles", "../shared/youtubeSubtitles.js"]
  ])
);
writeFileSync(
  join(tempContentDir, "youtubeSubtitleSession.js"),
  transpile("src/content/youtubeSubtitleSession.ts", [
    ["../shared/options", "../shared/options.js"],
    ["../shared/youtubeSubtitles", "../shared/youtubeSubtitles.js"],
    ["./youtubeCaptionTracks", "./youtubeCaptionTracks.js"],
    ["./youtubeTranscriptFetch", "./youtubeTranscriptFetch.js"],
    ["./youtubeSubtitleControl", "./youtubeSubtitleControl.js"],
    ["./youtubeSubtitleOverlay", "./youtubeSubtitleOverlay.js"]
  ])
);

try {
  const { YouTubeSubtitleSession } = await import(
    pathToFileURL(join(tempContentDir, "youtubeSubtitleSession.js")).href
  );

  const session = new YouTubeSubtitleSession({
    getPlayerResponse: () => playerResponseFixture,
    fetchTranscript: async () => [
      { id: "cue-0", startMs: 0, endMs: 1000, text: "Hello" }
    ]
  });

  await session.refresh();
  assert(
    sentMessages[0].type === "GET_SUBTITLE_TRANSLATION_CACHE",
    "session should check cache after transcript hash exists"
  );

  await session.acceptTranslation();
  assert(
    sentMessages.some((message) => message.type === "TRANSLATE_SUBTITLE_TRACK"),
    "accept should request subtitle translation"
  );
  assert(
    document.body.textContent.includes("안녕"),
    "successful translation should activate the overlay"
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
