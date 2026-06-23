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

async function assertDoesNotReject(promise, message) {
  try {
    await promise;
  } catch (error) {
    fail(`${message}: ${error?.message ?? error}`);
  }
}

async function flushPromises(count = 50) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
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
const captionContainer = document.createElement("div");
captionContainer.className = "ytp-caption-window-container";
captionContainer.setAttribute("id", "ytp-caption-window-container");
player.appendChild(video);
player.appendChild(captionContainer);
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
      if (message.type === "WRITE_DEBUG_LOG_EVENT") {
        return Promise.resolve({
          type: "DEBUG_LOG_WRITE_RESULT",
          requestId: message.requestId,
          ok: true,
          written: true
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
            timeoutMs: 30000,
            debugLogging: true
          }
        });
      }
    }
  }
};

const defaultSendMessage = global.chrome.runtime.sendMessage;
const defaultStorageGet = global.chrome.storage.local.get;

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

const fallbackPlayerResponseFixture = {
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl:
            "https://www.youtube.com/api/timedtext?v=abc123&lang=en-US",
          languageCode: "en-US",
          name: { simpleText: "English (United States)" },
          vssId: ".en-US"
        },
        {
          baseUrl:
            "https://www.youtube.com/api/timedtext?v=abc123&lang=en&kind=asr",
          languageCode: "en",
          kind: "asr",
          name: { simpleText: "English (auto-generated)" },
          vssId: "a.en"
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

const contentScriptSource = readFileSync("src/content/content-script.ts", "utf8");
assert(
  contentScriptSource.includes('"unhandledrejection"'),
  "content script should suppress extension context invalidation rejections"
);
assert(
  contentScriptSource.includes("event.preventDefault()"),
  "content script should prevent default logging for handled context invalidation rejections"
);
assert(
  contentScriptSource.includes("isExtensionContextInvalidated"),
  "content script should share context invalidation detection"
);
assert(
  readFileSync("src/content/youtubeSubtitleSession.ts", "utf8").includes(
    "function runSessionRefresh"
  ),
  "YouTube subtitle refresh calls should use a safe rejection wrapper"
);

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
    captionContainer.textContent.includes("안녕"),
    "successful translation should render in the YouTube caption container"
  );
  await session.refresh();
  assert(
    captionContainer.textContent.includes("안녕"),
    "same-source refresh should not clear an active translated subtitle"
  );

  const previousSentMessageCount = sentMessages.length;
  player.getPlayerResponse = () => playerResponseFixture;
  await new YouTubeSubtitleSession({
    fetchTranscript: async () => [
      { id: "cue-0", startMs: 0, endMs: 1000, text: "Hello" }
    ]
  }).refresh();
  assert(
    sentMessages.length > previousSentMessageCount &&
      sentMessages.at(-1).type === "GET_SUBTITLE_TRANSLATION_CACHE",
    "session should read caption tracks from the YouTube player getPlayerResponse API"
  );
  player.getPlayerResponse = undefined;

  const previousScriptSentMessageCount = sentMessages.length;
  const playerResponseScript = document.createElement("script");
  playerResponseScript.textContent = `var ytInitialPlayerResponse = ${JSON.stringify(playerResponseFixture)};`;
  document.body.appendChild(playerResponseScript);
  await new YouTubeSubtitleSession({
    fetchTranscript: async () => [
      { id: "cue-0", startMs: 0, endMs: 1000, text: "Hello" }
    ]
  }).refresh();
  assert(
    sentMessages.length > previousScriptSentMessageCount &&
      sentMessages.at(-1).type === "GET_SUBTITLE_TRANSLATION_CACHE",
    "session should fall back to parsing ytInitialPlayerResponse from page scripts"
  );

  const fallbackFetches = [];
  const previousFallbackSentMessageCount = sentMessages.length;
  await new YouTubeSubtitleSession({
    getPlayerResponse: () => fallbackPlayerResponseFixture,
    fetchTranscript: async (track) => {
      fallbackFetches.push(`${track.languageCode}:${track.kind}`);

      return track.kind === "manual"
        ? []
        : [{ id: "cue-0", startMs: 0, endMs: 1000, text: "Hello" }];
    }
  }).refresh();
  assert(
    fallbackFetches.join(",") === "en-US:manual,en:asr",
    "session should try the next caption track when the preferred track has no text"
  );
  assert(
    sentMessages.length > previousFallbackSentMessageCount &&
      sentMessages.at(-1).type === "GET_SUBTITLE_TRANSLATION_CACHE",
    "session should continue with the first caption track that yields transcript cues"
  );

  let refreshPanelApiFetchCount = 0;
  await new YouTubeSubtitleSession({
    getPlayerResponse: () => fallbackPlayerResponseFixture,
    fetchTranscript: async () => [],
    fetchTranscriptPanel: async () => {
      refreshPanelApiFetchCount += 1;

      return [
        { id: "panel-0", startMs: 0, endMs: 1000, text: "Hello from panel" }
      ];
    }
  }).refresh();
  assert(
    refreshPanelApiFetchCount === 0,
    "session should not call YouTube's get_transcript API automatically when timedtext tracks are empty"
  );

  const previousLazyPanelSentMessageCount = sentMessages.length;
  let lazyPanelTimedTextFetchCount = 0;
  let lazyPanelApiFetchCount = 0;
  const lazyPanelSession = new YouTubeSubtitleSession({
    getPlayerResponse: () => fallbackPlayerResponseFixture,
    fetchTranscript: async () => {
      lazyPanelTimedTextFetchCount += 1;

      return [];
    },
    fetchTranscriptPanel: async () => {
      lazyPanelApiFetchCount += 1;

      return [];
    },
    fetchTranscriptFromPanelDom: async (options) => {
      options?.onDebug?.("youtube.subtitle.panel_dom_wait", { cueCount: 1 });

      return [
        { id: "dom-panel-0", startMs: 0, endMs: 1000, text: "Hello from DOM" }
      ];
    }
  });
  await lazyPanelSession.refresh();
  assert(
    lazyPanelTimedTextFetchCount === 2 && lazyPanelApiFetchCount === 0,
    "refresh should make one best-effort direct transcript prefetch"
  );
  const lazyPanelControl = document.querySelector(
    '[data-hover-trans-port-youtube-subtitle-control="true"]'
  );
  assert(
    lazyPanelControl.getAttribute("data-hover-trans-port-status") === "prompt",
    "session should keep the translate button usable when caption tracks exist but direct transcript fetches are empty"
  );
  await lazyPanelSession.acceptTranslation();
  await flushPromises();
  assert(
    lazyPanelTimedTextFetchCount === 2 && lazyPanelApiFetchCount === 0,
    "accept should go straight to the rendered transcript panel after direct prefetch already failed"
  );
  assert(
    sentMessages.some(
      (message, index) =>
        index >= previousLazyPanelSentMessageCount &&
        message.type === "WRITE_DEBUG_LOG_EVENT" &&
        message.event === "youtube.subtitle.accept"
    ),
    "accept should write a debug event when YouTube subtitle debug logging is enabled"
  );
  assert(
    sentMessages.some(
      (message, index) =>
        index >= previousLazyPanelSentMessageCount &&
        message.type === "WRITE_DEBUG_LOG_EVENT" &&
        message.event === "youtube.subtitle.panel_dom_wait" &&
        message.fields?.cueCount === 1
    ),
    "accept should write a debug event with the transcript panel DOM cue count"
  );
  assert(
    sentMessages.some(
      (message, index) =>
        index >= previousLazyPanelSentMessageCount &&
        message.type === "WRITE_DEBUG_LOG_EVENT" &&
        message.event === "youtube.subtitle.source_loaded" &&
        message.fields?.cueCount === 1
    ),
    "accept should write a debug event after loading subtitle cues"
  );
  assert(
    sentMessages.some(
      (message, index) =>
        index >= previousLazyPanelSentMessageCount &&
        message.type === "WRITE_DEBUG_LOG_EVENT" &&
        message.event === "youtube.subtitle.cache_lookup_result" &&
        message.fields?.ok === true &&
        message.fields?.cached === false
    ),
    "accept should write a debug event with the subtitle cache lookup result"
  );
  assert(
    sentMessages.some(
      (message, index) =>
        index >= previousLazyPanelSentMessageCount &&
        message.type === "WRITE_DEBUG_LOG_EVENT" &&
        message.event === "youtube.subtitle.translation_start" &&
        message.fields?.cueCount === 1 &&
        message.fields?.chunkCountEstimate === 1
    ),
    "accept should write a debug event before requesting subtitle translation"
  );
  assert(
    sentMessages.some(
      (message, index) =>
        index >= previousLazyPanelSentMessageCount &&
        message.type === "WRITE_DEBUG_LOG_EVENT" &&
        message.event === "youtube.subtitle.translation_result" &&
        message.fields?.ok === true &&
        message.fields?.translatedCueCount === 1
    ),
    "accept should write a debug event with the subtitle translation result"
  );
  assert(
    sentMessages.some(
      (message, index) =>
        index >= previousLazyPanelSentMessageCount &&
        message.type === "WRITE_DEBUG_LOG_EVENT" &&
        message.event === "youtube.subtitle.overlay_activated" &&
        message.fields?.cueCount === 1 &&
        message.fields?.activeCueId === "cue-0" &&
        message.fields?.overlayNodeHidden === false &&
        message.fields?.overlayTextLength === 2 &&
        message.fields?.captionContainerActive === true
    ),
    "accept should write a debug event with the active translated cue"
  );
  assert(
    sentMessages.length > previousLazyPanelSentMessageCount &&
      sentMessages.some(
        (message, index) =>
          index >= previousLazyPanelSentMessageCount &&
          message.type === "TRANSLATE_SUBTITLE_TRACK" &&
          message.cues[0].text === "Hello from DOM"
      ),
    "accept should collect transcript cues from YouTube's rendered transcript panel before translating"
  );

  let repeatedEmptyFetchCount = 0;
  const repeatedEmptySession = new YouTubeSubtitleSession({
    getPlayerResponse: () => fallbackPlayerResponseFixture,
    fetchTranscript: async () => {
      repeatedEmptyFetchCount += 1;

      return [];
    },
    fetchTranscriptPanel: async () => []
  });
  await repeatedEmptySession.refresh();
  await repeatedEmptySession.refresh();
  assert(
    repeatedEmptyFetchCount === 2,
    "session should not repeatedly refetch the same empty pending subtitle source on every refresh"
  );

  global.chrome.storage.local.get = () =>
    Promise.reject(new Error("Extension context invalidated."));
  await assertDoesNotReject(
    new YouTubeSubtitleSession({
      getPlayerResponse: () => playerResponseFixture,
      fetchTranscript: async () => [
        { id: "cue-0", startMs: 0, endMs: 1000, text: "Hello" }
      ]
    }).refresh(),
    "refresh should absorb extension context invalidation"
  );
  global.chrome.storage.local.get = defaultStorageGet;

  const invalidatedSession = new YouTubeSubtitleSession({
    getPlayerResponse: () => playerResponseFixture,
    fetchTranscript: async () => [
      { id: "cue-0", startMs: 0, endMs: 1000, text: "Hello" }
    ]
  });
  await invalidatedSession.refresh();
  global.chrome.runtime.sendMessage = (message) => {
    if (message.type === "TRANSLATE_SUBTITLE_TRACK") {
      return Promise.reject(new Error("Extension context invalidated."));
    }

    return defaultSendMessage(message);
  };
  await assertDoesNotReject(
    invalidatedSession.acceptTranslation(),
    "accept should absorb extension context invalidation"
  );
  global.chrome.runtime.sendMessage = defaultSendMessage;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
