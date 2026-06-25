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
  console.error(`youtube-transcript-fetch-check: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

async function assertRejects(promise, message) {
  try {
    await promise;
  } catch {
    return;
  }

  fail(message);
}

function transpile(sourcePath) {
  return ts.transpileModule(readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
}

function decodeXmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

class FakeTextArea {
  value = "";

  set innerHTML(text) {
    this.value = decodeXmlEntities(text);
  }
}

class FakeXmlTextNode {
  constructor(attributes, textContent) {
    this.attributes = attributes;
    this.textContent = textContent;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

class FakeXmlDocument {
  constructor(nodes) {
    this.nodes = nodes;
  }

  querySelectorAll(selector) {
    return selector === "text" ? this.nodes : [];
  }
}

class FakeDomParser {
  parseFromString(text) {
    const nodes = [...text.matchAll(/<text\s+([^>]*)>([\s\S]*?)<\/text>/g)].map(
      ([, rawAttributes, rawText]) => {
        const attributes = new Map(
          [...rawAttributes.matchAll(/([a-z]+)="([^"]*)"/g)].map(
            ([, name, value]) => [name, value]
          )
        );

        return new FakeXmlTextNode(attributes, decodeXmlEntities(rawText));
      }
    );

    return new FakeXmlDocument(nodes);
  }
}

class FakeTranscriptSegment {
  constructor(timestamp, text) {
    this.timestamp = timestamp;
    this.text = text;
  }

  querySelector(selector) {
    if (selector.toLowerCase().includes("timestamp")) {
      return { textContent: this.timestamp };
    }

    if (selector.includes("text")) {
      return { textContent: this.text };
    }

    return null;
  }
}

class FakeModernTranscriptSegment {
  constructor(timestamp, text) {
    this.timestamp = timestamp;
    this.text = text;
  }

  querySelector(selector) {
    if (selector.includes("ytwTranscriptSegmentViewModelTimestamp")) {
      return { textContent: this.timestamp };
    }

    if (
      selector.includes("span[role='text']") ||
      selector.includes(".ytAttributedStringHost")
    ) {
      return { textContent: this.text };
    }

    return null;
  }
}

const fakeScripts = [];
const fakeTranscriptSegments = [];
const fakeModernTranscriptSegments = [];
const fakeTranscriptPanelElements = [];
const fakeButtons = [];
global.document = {
  createElement(tagName) {
    if (tagName !== "textarea") {
      throw new Error(`Unexpected element: ${tagName}`);
    }

    return new FakeTextArea();
  },
  querySelectorAll(selector) {
    if (selector === "script") {
      return fakeScripts;
    }

    if (
      selector.includes("ytd-transcript-segment-renderer") ||
      selector.includes("yt-transcript-segment-renderer") ||
      selector.includes("transcript-segment-view-model")
    ) {
      return [...fakeTranscriptSegments, ...fakeModernTranscriptSegments];
    }

    if (
      selector.includes("ytd-transcript-renderer") ||
      selector.includes("ytd-transcript-search-panel-renderer") ||
      selector.includes("ytd-transcript-segment-list-renderer") ||
      selector.includes("yt-transcript-renderer") ||
      selector.includes("yt-section-list-renderer") ||
      selector.includes("ytd-engagement-panel-section-list-renderer")
    ) {
      return fakeTranscriptPanelElements;
    }

    if (selector.includes("button")) {
      return fakeButtons;
    }

    return [];
  }
};
global.DOMParser = FakeDomParser;
global.window = { setTimeout };

const tempDir = mkdtempSync(
  join(tmpdir(), "hover-trans-port-youtube-transcript-fetch-")
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
  join(tempContentDir, "youtubeTranscriptFetch.js"),
  transpile("src/content/youtubeTranscriptFetch.ts").replace(
    "../shared/youtubeSubtitles",
    "../shared/youtubeSubtitles.js"
  )
);

try {
  const {
    fetchYouTubeTranscript,
    fetchYouTubeTranscriptFromTranscriptPanel,
    fetchYouTubeTranscriptPanel,
    parseYouTubeInnertubeTranscript,
    parseYouTubeJson3Transcript,
    parseYouTubeTranscriptPanelDocument,
    parseYouTubeXmlTranscript
  } = await import(
    pathToFileURL(join(tempContentDir, "youtubeTranscriptFetch.js")).href
  );

  const json3 = JSON.stringify({
    events: [
      {
        tStartMs: 0,
        dDurationMs: 1200,
        segs: [{ utf8: "Hello" }, { utf8: " world" }]
      },
      { tStartMs: 1400, dDurationMs: 600, segs: [{ utf8: "\n" }] },
      { tStartMs: 2200, dDurationMs: 900, segs: [{ utf8: "Bye" }] }
    ]
  });
  const jsonCues = parseYouTubeJson3Transcript(json3);
  assert(jsonCues.length === 2, "blank JSON3 cue should be removed");
  assert(jsonCues[0].id === "cue-0", "JSON3 cue ids should be deterministic");
  assert(
    jsonCues[0].text === "Hello world",
    "JSON3 cue text should join segments"
  );

  const xml =
    '<transcript><text start="1.5" dur="2">Tom &amp; Jerry</text></transcript>';
  const xmlCues = parseYouTubeXmlTranscript(xml);
  assert(xmlCues.length === 1, "XML cue should parse");
  assert(
    xmlCues[0].startMs === 1500,
    "XML start seconds should become milliseconds"
  );
  assert(
    xmlCues[0].endMs === 3500,
    "XML duration seconds should become end milliseconds"
  );
  assert(xmlCues[0].text === "Tom & Jerry", "XML entities should decode");

  let fetchRequest = null;
  global.fetch = (url, init) => {
    fetchRequest = { url: String(url), init };

    return Promise.resolve({
      ok: true,
      headers: { get: () => "application/json" },
      text: () => Promise.resolve(json3)
    });
  };
  await fetchYouTubeTranscript({
    id: ".en",
    languageCode: "en",
    displayName: "English",
    kind: "manual",
    baseUrl: "https://www.youtube.com/api/timedtext?v=abc&lang=en"
  });
  assert(
    fetchRequest.init.credentials === "include",
    "YouTube timedtext fetch should include YouTube credentials for signed caption URLs"
  );
  assert(
    fetchRequest.url.includes("fmt=json3"),
    "YouTube timedtext fetch should request json3 format"
  );
  fetchRequest = null;
  await assertRejects(
    fetchYouTubeTranscript({
      id: ".fr",
      languageCode: "fr",
      displayName: "French",
      kind: "manual",
      baseUrl: "https://evil.example/api/timedtext?v=abc&lang=fr"
    }),
    "YouTube timedtext fetch should reject non-YouTube transcript URLs"
  );
  assert(
    fetchRequest === null,
    "invalid YouTube timedtext URLs should be rejected before fetch"
  );

  const innertubeResponse = {
    actions: [
      {
        updateEngagementPanelAction: {
          content: {
            transcriptRenderer: {
              body: {
                transcriptSegmentListRenderer: {
                  initialSegments: [
                    {
                      transcriptSegmentRenderer: {
                        startMs: "0",
                        endMs: "1200",
                        snippet: { runs: [{ text: "Panel" }, { text: " cue" }] }
                      }
                    }
                  ]
                }
              }
            }
          }
        }
      }
    ]
  };
  const innertubeCues = parseYouTubeInnertubeTranscript(innertubeResponse);
  assert(innertubeCues.length === 1, "Innertube transcript cue should parse");
  assert(
    innertubeCues[0].text === "Panel cue",
    "Innertube transcript runs should join"
  );

  fakeScripts.push({
    textContent:
      'ytcfg.set({"INNERTUBE_API_KEY":"test-key","INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"2.0","visitorData":"visitor"}}}); window["ytInitialData"] = {"engagementPanels":[{"content":{"continuationItemRenderer":{"continuationEndpoint":{"getTranscriptEndpoint":{"videoId":"abc","params":"panel\\u003Dparams"}}}}}]};'
  });
  let panelFetchRequest = null;
  global.fetch = (url, init) => {
    panelFetchRequest = { url: String(url), init };

    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(innertubeResponse)
    });
  };
  const panelCues = await fetchYouTubeTranscriptPanel();
  assert(panelCues.length === 1, "transcript panel fallback should return cues");
  assert(
    panelFetchRequest.url.includes("/youtubei/v1/get_transcript") &&
      panelFetchRequest.url.includes("key=test-key"),
    "transcript panel fallback should call the YouTube Innertube transcript endpoint"
  );
  assert(
    panelFetchRequest.init.credentials === "include",
    "transcript panel fallback should include YouTube credentials"
  );
  assert(
    panelFetchRequest.init.headers["x-youtube-client-name"] === "1",
    "transcript panel fallback should send the WEB client header expected by YouTube"
  );
  assert(
    JSON.parse(panelFetchRequest.init.body).params === "panel=params",
    "transcript panel fallback should parse escaped params from ytInitialData"
  );

  fakeTranscriptSegments.push(
    new FakeTranscriptSegment("0:01", "First panel line"),
    new FakeTranscriptSegment("0:04", "Second panel line")
  );
  const domPanelCues = parseYouTubeTranscriptPanelDocument();
  assert(domPanelCues.length === 2, "transcript panel DOM cues should parse");
  assert(
    domPanelCues[0].startMs === 1000 && domPanelCues[0].endMs === 4000,
    "transcript panel DOM cue end should use the next segment timestamp"
  );
  assert(
    domPanelCues[1].text === "Second panel line",
    "transcript panel DOM cue text should parse"
  );

  fakeTranscriptSegments.length = 0;
  fakeTranscriptSegments.push(
    new FakeTranscriptSegment("0:01", "First panel line"),
    new FakeTranscriptSegment("0:01", "First panel line"),
    new FakeTranscriptSegment("0:04", "Second panel line"),
    new FakeTranscriptSegment("0:04", "Second panel line")
  );
  const dedupedDomPanelCues = parseYouTubeTranscriptPanelDocument();
  assert(
    dedupedDomPanelCues.length === 2,
    "transcript panel DOM cues should dedupe duplicate rendered segments"
  );
  assert(
    dedupedDomPanelCues[0].startMs === 1000 &&
      dedupedDomPanelCues[0].endMs === 4000,
    "deduped transcript panel DOM cue end should use the next unique segment timestamp"
  );

  fakeTranscriptSegments.length = 0;
  fakeModernTranscriptSegments.push(
    new FakeModernTranscriptSegment("0:00", "Modern transcript line"),
    new FakeModernTranscriptSegment("0:07", "Second modern line")
  );
  const modernDomPanelCues = parseYouTubeTranscriptPanelDocument();
  assert(
    modernDomPanelCues.length === 2,
    "modern transcript panel DOM cues should parse"
  );
  assert(
    modernDomPanelCues[0].startMs === 0 &&
      modernDomPanelCues[0].endMs === 7000,
    "modern transcript panel DOM cue end should use the next segment timestamp"
  );
  assert(
    modernDomPanelCues[0].text === "Modern transcript line",
    "modern transcript panel DOM cue text should parse"
  );

  fakeModernTranscriptSegments.length = 0;
  fakeTranscriptSegments.length = 0;
  let transcriptButtonClicks = 0;
  let transcriptCloseClicks = 0;
  fakeButtons.push({
    tagName: "BUTTON",
    textContent: "스크립트 표시",
    getAttribute: () => null,
    click() {
      transcriptButtonClicks += 1;
      fakeTranscriptSegments.push(
        new FakeTranscriptSegment("0:02", "Loaded from YouTube transcript panel")
      );
    }
  });
  fakeButtons.push({
    tagName: "BUTTON",
    textContent: "닫기",
    getAttribute: () => null,
    click() {
      transcriptCloseClicks += 1;
    }
  });
  const panelDebugEvents = [];
  const loadedPanelCues = await fetchYouTubeTranscriptFromTranscriptPanel({
    onDebug(event, fields) {
      panelDebugEvents.push({ event, fields });
    }
  });
  assert(
    transcriptButtonClicks === 1,
    "transcript panel fallback should click YouTube's transcript button"
  );
  assert(
    transcriptCloseClicks === 1,
    "transcript panel fallback should close the rendered transcript panel after reading it"
  );
  assert(
    loadedPanelCues.length === 1 &&
      loadedPanelCues[0].text === "Loaded from YouTube transcript panel",
    "transcript panel fallback should read cues after YouTube renders the panel"
  );
  assert(
    panelDebugEvents.some(
      ({ event, fields }) =>
        event === "youtube.subtitle.panel_dom_open" &&
        fields.opened === true &&
        fields.openMethod === "transcript-button"
    ),
    "transcript panel fallback should debug-log how it tried to open the YouTube transcript panel"
  );
  assert(
    panelDebugEvents.some(
      ({ event, fields }) =>
        event === "youtube.subtitle.panel_dom_wait" &&
        fields.cueCount === 1
    ),
    "transcript panel fallback should debug-log the final rendered transcript cue count"
  );
  assert(
    panelDebugEvents.some(
      ({ event, fields }) =>
        event === "youtube.subtitle.panel_dom_close" &&
        fields.closed === true
    ),
    "transcript panel fallback should debug-log whether it closed the rendered transcript panel"
  );

  fakeTranscriptSegments.length = 0;
  fakeTranscriptPanelElements.length = 0;
  fakeButtons.length = 0;
  let emptyTranscriptButtonClicks = 0;
  let emptyTranscriptCloseClicks = 0;
  fakeButtons.push({
    tagName: "BUTTON",
    textContent: "스크립트 표시",
    getAttribute: () => null,
    click() {
      emptyTranscriptButtonClicks += 1;
      fakeTranscriptPanelElements.push({});
    }
  });
  fakeButtons.push({
    tagName: "BUTTON",
    textContent: "닫기",
    getAttribute: () => null,
    click() {
      emptyTranscriptCloseClicks += 1;
      fakeTranscriptPanelElements.length = 0;
    }
  });
  const emptyPanelDebugEvents = [];
  const emptyPanelCues = await fetchYouTubeTranscriptFromTranscriptPanel({
    timeoutMs: 20,
    onDebug(event, fields) {
      emptyPanelDebugEvents.push({ event, fields });
    }
  });
  assert(
    emptyPanelCues.length === 0,
    "empty transcript panel fallback should still return no cues"
  );
  assert(
    emptyTranscriptButtonClicks === 1,
    "empty transcript panel fallback should click YouTube's transcript button"
  );
  assert(
    emptyTranscriptCloseClicks === 1,
    "empty transcript panel fallback should close an opened but empty transcript panel"
  );
  assert(
    emptyPanelDebugEvents.some(
      ({ event, fields }) =>
        event === "youtube.subtitle.panel_dom_close" &&
        fields.closed === true
    ),
    "empty transcript panel fallback should debug-log that the opened empty panel was closed"
  );

  fakeTranscriptPanelElements.length = 0;
  fakeTranscriptSegments.length = 0;
  fakeButtons.length = 0;
  let wrapperClicks = 0;
  let nestedButtonClicks = 0;
  const nestedTranscriptButton = {
    tagName: "BUTTON",
    textContent: "",
    getAttribute: () => null,
    click() {
      nestedButtonClicks += 1;
      fakeTranscriptSegments.push(
        new FakeTranscriptSegment("0:03", "Loaded from nested transcript button")
      );
    }
  };
  fakeButtons.push({
    tagName: "YTD-BUTTON-RENDERER",
    textContent: "스크립트 표시",
    getAttribute: () => null,
    querySelector(selector) {
      return selector.includes("button") ? nestedTranscriptButton : null;
    },
    click() {
      wrapperClicks += 1;
    }
  });
  const nestedButtonCues = await fetchYouTubeTranscriptFromTranscriptPanel({
    timeoutMs: 20
  });
  assert(
    wrapperClicks === 0 && nestedButtonClicks === 1,
    "transcript panel fallback should click a nested real button instead of its wrapper"
  );
  assert(
    nestedButtonCues.length === 1 &&
      nestedButtonCues[0].text === "Loaded from nested transcript button",
    "transcript panel fallback should read cues after clicking the nested transcript button"
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
