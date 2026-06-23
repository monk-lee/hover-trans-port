import type {
  YouTubeCaptionTrack,
  YouTubeSubtitleCue
} from "../shared/youtubeSubtitles";
import { normalizeSubtitleCues } from "../shared/youtubeSubtitles";

type InnertubeContext = {
  client?: {
    clientName?: string;
    clientVersion?: string;
    visitorData?: string;
  };
};

type TranscriptPanelRequest = {
  apiKey: string;
  context: InnertubeContext;
  params: string;
};

export function withJson3Format(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("fmt", "json3");

  return url.toString();
}

export function parseYouTubeJson3Transcript(
  text: string
): YouTubeSubtitleCue[] {
  const value = JSON.parse(text) as {
    events?: Array<{
      tStartMs?: number;
      dDurationMs?: number;
      segs?: Array<{ utf8?: string }>;
    }>;
  };
  const cues = (value.events ?? []).map((event, index) => ({
    id: `cue-${index}`,
    startMs: event.tStartMs ?? 0,
    endMs: (event.tStartMs ?? 0) + (event.dDurationMs ?? 0),
    text: (event.segs ?? []).map((seg) => seg.utf8 ?? "").join("")
  }));

  return normalizeSubtitleCues(cues);
}

function decodeXmlText(text: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;

  return textarea.value;
}

export function parseYouTubeXmlTranscript(text: string): YouTubeSubtitleCue[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/xml");
  const nodes = Array.from(doc.querySelectorAll("text"));

  return normalizeSubtitleCues(
    nodes.map((node, index) => {
      const start = Number(node.getAttribute("start") ?? "0") * 1000;
      const duration = Number(node.getAttribute("dur") ?? "0") * 1000;

      return {
        id: `cue-${index}`,
        startMs: start,
        endMs: start + duration,
        text: decodeXmlText(node.textContent ?? "")
      };
    })
  );
}

export async function fetchYouTubeTranscript(
  track: YouTubeCaptionTrack
): Promise<YouTubeSubtitleCue[]> {
  const response = await fetch(withJson3Format(track.baseUrl), {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(
      `YouTube transcript request failed with HTTP ${response.status}.`
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  return contentType.includes("json") || text.trim().startsWith("{")
    ? parseYouTubeJson3Transcript(text)
    : parseYouTubeXmlTranscript(text);
}

export async function fetchYouTubeTranscriptPanel(): Promise<YouTubeSubtitleCue[]> {
  const request = readTranscriptPanelRequest();

  if (!request) {
    return [];
  }

  const response = await fetch(
    `/youtubei/v1/get_transcript?key=${encodeURIComponent(
      request.apiKey
    )}&prettyPrint=false`,
    {
      method: "POST",
      credentials: "include",
      headers: createInnertubeHeaders(request.context),
      body: JSON.stringify({
        context: request.context,
        params: request.params
      })
    }
  );

  if (!response.ok) {
    return [];
  }

  return parseYouTubeInnertubeTranscript(await response.json());
}

export function parseYouTubeInnertubeTranscript(
  value: unknown
): YouTubeSubtitleCue[] {
  const cues: YouTubeSubtitleCue[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }

    const record = node as Record<string, unknown>;
    const segment = record.transcriptSegmentRenderer;
    const cue = record.transcriptCueRenderer;

    if (segment && typeof segment === "object") {
      const parsed = parseTranscriptRendererCue(
        segment as Record<string, unknown>,
        cues.length
      );

      if (parsed) {
        cues.push(parsed);
      }
    }

    if (cue && typeof cue === "object") {
      const parsed = parseTranscriptRendererCue(
        cue as Record<string, unknown>,
        cues.length
      );

      if (parsed) {
        cues.push(parsed);
      }
    }

    for (const child of Object.values(record)) {
      visit(child);
    }
  };

  visit(value);
  return normalizeSubtitleCues(cues);
}

function parseTranscriptRendererCue(
  value: Record<string, unknown>,
  index: number
): YouTubeSubtitleCue | null {
  const startMs =
    parseMilliseconds(value.startMs) ??
    parseMilliseconds(value.startTimeMs) ??
    parseMilliseconds(value.startOffsetMs);
  const durationMs = parseMilliseconds(value.durationMs);
  const endMs =
    parseMilliseconds(value.endMs) ??
    (startMs !== null && durationMs !== null ? startMs + durationMs : null);
  const text =
    formattedText(value.snippet) ??
    formattedText(value.cue) ??
    formattedText(value.text);

  if (startMs === null || endMs === null || !text) {
    return null;
  }

  return {
    id: `panel-cue-${index}`,
    startMs,
    endMs,
    text
  };
}

function formattedText(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const formatted = value as {
    simpleText?: unknown;
    runs?: Array<{ text?: unknown }>;
  };

  if (typeof formatted.simpleText === "string") {
    return formatted.simpleText;
  }

  if (Array.isArray(formatted.runs)) {
    return formatted.runs
      .map((run) => (typeof run.text === "string" ? run.text : ""))
      .join("");
  }

  return null;
}

function parseMilliseconds(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function readTranscriptPanelRequest(): TranscriptPanelRequest | null {
  const scripts = Array.from(document.querySelectorAll("script"))
    .map((script) => script.textContent ?? "")
    .join("\n");
  const apiKey = readJsonStringSetting(scripts, "INNERTUBE_API_KEY");
  const contextJson = extractJsonObjectAfterSetting(scripts, "INNERTUBE_CONTEXT");
  const params = readTranscriptEndpointParams(scripts);

  if (!apiKey || !contextJson || !params) {
    return null;
  }

  try {
    return {
      apiKey,
      context: JSON.parse(contextJson) as InnertubeContext,
      params
    };
  } catch {
    return null;
  }
}

function readTranscriptEndpointParams(text: string): string | null {
  return (
    readTranscriptEndpointParamsFromInitialData(text) ??
    readTranscriptEndpointParamsWithPattern(text)
  );
}

function readTranscriptEndpointParamsFromInitialData(text: string): string | null {
  let searchIndex = 0;

  while (searchIndex < text.length) {
    const markerIndex = text.indexOf("ytInitialData", searchIndex);

    if (markerIndex < 0) {
      return null;
    }

    const objectStart = text.indexOf("{", markerIndex);

    if (objectStart < 0) {
      return null;
    }

    const objectJson = extractJsonObjectAt(text, objectStart);

    if (!objectJson) {
      searchIndex = objectStart + 1;
      continue;
    }

    try {
      const params = findTranscriptEndpointParams(JSON.parse(objectJson));

      if (params) {
        return params;
      }
    } catch {
      // Keep scanning; YouTube can place non-JSON snippets near this marker.
    }

    searchIndex = objectStart + objectJson.length;
  }

  return null;
}

function findTranscriptEndpointParams(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const params = findTranscriptEndpointParams(item);

      if (params) {
        return params;
      }
    }

    return null;
  }

  const record = value as Record<string, unknown>;
  const endpoint = record.getTranscriptEndpoint;

  if (endpoint && typeof endpoint === "object") {
    const params = (endpoint as Record<string, unknown>).params;

    if (typeof params === "string" && params) {
      return params;
    }
  }

  for (const child of Object.values(record)) {
    const params = findTranscriptEndpointParams(child);

    if (params) {
      return params;
    }
  }

  return null;
}

function readTranscriptEndpointParamsWithPattern(text: string): string | null {
  const rawParams = text.match(
    /"getTranscriptEndpoint"\s*:\s*\{[^}]*"params"\s*:\s*"((?:\\.|[^"\\])+)"/u
  )?.[1];

  return rawParams ? decodeJsonStringLiteral(rawParams) : null;
}

function decodeJsonStringLiteral(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function readJsonStringSetting(text: string, key: string): string | null {
  return (
    text.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, "u"))?.[1] ?? null
  );
}

function extractJsonObjectAfterSetting(text: string, key: string): string | null {
  const marker = `"${key}"`;
  const markerIndex = text.indexOf(marker);
  const objectStart =
    markerIndex >= 0 ? text.indexOf("{", markerIndex + marker.length) : -1;

  if (objectStart < 0) {
    return null;
  }

  return extractJsonObjectAt(text, objectStart);
}

function extractJsonObjectAt(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function createInnertubeHeaders(context: InnertubeContext): HeadersInit {
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  const client = context.client;

  if (client?.clientName) {
    headers["x-youtube-client-name"] =
      client.clientName === "WEB" ? "1" : client.clientName;
  }

  if (client?.clientVersion) {
    headers["x-youtube-client-version"] = client.clientVersion;
  }

  if (client?.visitorData) {
    headers["x-goog-visitor-id"] = client.visitorData;
  }

  return headers;
}
