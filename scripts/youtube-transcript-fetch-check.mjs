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

const fakeScripts = [];
global.document = {
  createElement(tagName) {
    if (tagName !== "textarea") {
      throw new Error(`Unexpected element: ${tagName}`);
    }

    return new FakeTextArea();
  },
  querySelectorAll(selector) {
    return selector === "script" ? fakeScripts : [];
  }
};
global.DOMParser = FakeDomParser;

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
    fetchYouTubeTranscriptPanel,
    parseYouTubeInnertubeTranscript,
    parseYouTubeJson3Transcript,
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
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
