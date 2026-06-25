import type {
  YouTubeCaptionTrack,
  YouTubeSubtitleCue
} from "../shared/youtubeSubtitles";
import {
  normalizeSubtitleCues,
  normalizeYouTubeTimedTextBaseUrl
} from "../shared/youtubeSubtitles";

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

type TranscriptPanelDebugFields = Record<
  string,
  string | number | boolean | null | undefined
>;

type TranscriptPanelDebugLogger = (
  event: string,
  fields?: TranscriptPanelDebugFields
) => void;

type TranscriptPanelFetchOptions = {
  onDebug?: TranscriptPanelDebugLogger;
  timeoutMs?: number;
};

type TranscriptPanelOpenResult = {
  opened: boolean;
  openMethod: string;
  buttonCandidateCount: number;
  visibleCandidateCount?: number;
  matchedText: string | null;
  matchedTagName?: string | null;
  clickTargetTagName?: string | null;
};

type TranscriptPanelCloseResult = {
  closed: boolean;
  closeMethod: string;
  buttonCandidateCount: number;
  visibleCandidateCount?: number;
  matchedText: string | null;
  matchedTagName?: string | null;
  clickTargetTagName?: string | null;
};

const TRANSCRIPT_SEGMENT_SELECTOR =
  [
    "ytd-transcript-segment-renderer",
    "yt-transcript-segment-renderer",
    "transcript-segment-view-model"
  ].join(", ");
const TRANSCRIPT_BUTTON_SELECTOR =
  [
    "button",
    '[role="button"]',
    "tp-yt-paper-button",
    "ytd-button-renderer",
    "yt-button-shape button",
    "yt-chip-cloud-chip-renderer",
    "yt-button-view-model",
    "button-view-model",
    "a[role='button']"
  ].join(", ");
const TRANSCRIPT_CLICK_TARGET_SELECTOR =
  "button, a[role='button'], [role='button']";
const TRANSCRIPT_BUTTON_TEXT_PATTERN =
  /스크립트\s*표시|show transcript|transcript/iu;
const SHOW_MORE_BUTTON_TEXT_PATTERN = /더보기|show more/iu;
const CLOSE_TRANSCRIPT_PANEL_TEXT_PATTERN = /닫기|close/iu;

export function withJson3Format(baseUrl: string): string {
  const normalized = normalizeYouTubeTimedTextBaseUrl(baseUrl);

  if (!normalized) {
    throw new Error("Unsupported YouTube transcript URL.");
  }

  const url = new URL(normalized);
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

export async function fetchYouTubeTranscriptFromTranscriptPanel(
  options: TranscriptPanelFetchOptions = {}
): Promise<YouTubeSubtitleCue[]> {
  const existingCues = parseYouTubeTranscriptPanelDocument();
  options.onDebug?.("youtube.subtitle.panel_dom_existing", {
    cueCount: existingCues.length,
    segmentElementCount: countTranscriptSegmentElements(),
    panelElementCount: countTranscriptPanelElements()
  });

  if (existingCues.length > 0) {
    return existingCues;
  }

  const openResult = await openYouTubeTranscriptPanel();
  options.onDebug?.("youtube.subtitle.panel_dom_open", openResult);

  if (!openResult.opened) {
    return [];
  }

  const panelCues = await waitForTranscriptPanelCues(options);
  options.onDebug?.(
    "youtube.subtitle.panel_dom_close",
    closeYouTubeTranscriptPanel()
  );

  return panelCues;
}

export function parseYouTubeTranscriptPanelDocument(
  root: Pick<ParentNode, "querySelectorAll"> = document
): YouTubeSubtitleCue[] {
  const segments = Array.from(root.querySelectorAll(TRANSCRIPT_SEGMENT_SELECTOR));
  const parsedSegments = dedupeTranscriptPanelSegments(
    segments
    .map((segment) => {
      const startMs = parseTimestampToMilliseconds(
        findTranscriptSegmentTimestamp(segment)
      );
      const text = formattedTranscriptPanelText(
        findTranscriptSegmentText(segment)
      );

      return startMs === null || !text ? null : { startMs, text };
    })
    .filter(
      (segment): segment is { startMs: number; text: string } => segment !== null
    )
  );

  return normalizeSubtitleCues(
    parsedSegments.map((segment, index) => ({
      id: `transcript-panel-dom-${index}`,
      startMs: segment.startMs,
      endMs: Math.max(
        segment.startMs + 1000,
        parsedSegments[index + 1]?.startMs ?? segment.startMs + 4000
      ),
      text: segment.text
    }))
  );
}

function dedupeTranscriptPanelSegments(
  segments: Array<{ startMs: number; text: string }>
): Array<{ startMs: number; text: string }> {
  const seen = new Set<string>();
  const deduped: Array<{ startMs: number; text: string }> = [];

  for (const segment of segments) {
    const key = `${segment.startMs}\n${segment.text}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(segment);
  }

  return deduped;
}

async function openYouTubeTranscriptPanel(): Promise<TranscriptPanelOpenResult> {
  const transcriptButtonClick = clickButtonMatchingText(
    TRANSCRIPT_BUTTON_TEXT_PATTERN
  );

  if (transcriptButtonClick.clicked) {
    return {
      opened: true,
      openMethod: "transcript-button",
      buttonCandidateCount: transcriptButtonClick.buttonCandidateCount,
      matchedText: transcriptButtonClick.matchedText
    };
  }

  const showMoreClick = clickButtonMatchingText(SHOW_MORE_BUTTON_TEXT_PATTERN);

  if (showMoreClick.clicked) {
    await delay(200);
    const expandedTranscriptButtonClick = clickButtonMatchingText(
      TRANSCRIPT_BUTTON_TEXT_PATTERN
    );

    return {
      opened: expandedTranscriptButtonClick.clicked,
      openMethod: expandedTranscriptButtonClick.clicked
        ? "show-more-transcript-button"
        : "show-more-only",
      buttonCandidateCount:
        showMoreClick.buttonCandidateCount +
        expandedTranscriptButtonClick.buttonCandidateCount,
      matchedText:
        expandedTranscriptButtonClick.matchedText ?? showMoreClick.matchedText
    };
  }

  return {
    opened: false,
    openMethod: "not-found",
    buttonCandidateCount: transcriptButtonClick.buttonCandidateCount,
    matchedText: null
  };
}

async function waitForTranscriptPanelCues(
  options: TranscriptPanelFetchOptions
): Promise<YouTubeSubtitleCue[]> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 5000;
  let pollCount = 0;

  while (Date.now() - startedAt < timeoutMs) {
    pollCount += 1;
    const cues = parseYouTubeTranscriptPanelDocument();

    if (cues.length > 0) {
      options.onDebug?.("youtube.subtitle.panel_dom_wait", {
        cueCount: cues.length,
        elapsedMs: Date.now() - startedAt,
        pollCount,
        segmentElementCount: countTranscriptSegmentElements(),
        panelElementCount: countTranscriptPanelElements()
      });
      return cues;
    }

    await delay(100);
  }

  options.onDebug?.("youtube.subtitle.panel_dom_wait", {
    cueCount: 0,
    elapsedMs: Date.now() - startedAt,
    pollCount,
    segmentElementCount: countTranscriptSegmentElements(),
    panelElementCount: countTranscriptPanelElements()
  });
  return [];
}

function clickButtonMatchingText(pattern: RegExp): {
  clicked: boolean;
  buttonCandidateCount: number;
  visibleCandidateCount: number;
  matchedText: string | null;
  matchedTagName: string | null;
  clickTargetTagName: string | null;
} {
  const candidates = Array.from(
    document.querySelectorAll(TRANSCRIPT_BUTTON_SELECTOR)
  );
  let visibleCandidateCount = 0;

  for (const element of candidates) {
    const clickTarget = findTranscriptClickTarget(element);
    const candidateVisible = isVisibleForClick(element);
    const clickTargetVisible =
      clickTarget === element || clickTarget === null
        ? candidateVisible
        : isVisibleForClick(clickTarget);

    if (candidateVisible || clickTargetVisible) {
      visibleCandidateCount += 1;
    }

    const text = [
      element.textContent ?? "",
      element.getAttribute("aria-label") ?? "",
      element.getAttribute("title") ?? ""
    ].join(" ");

    if (!pattern.test(text) || (!candidateVisible && !clickTargetVisible)) {
      continue;
    }

    if (!clickTarget || typeof clickTarget.click !== "function") {
      continue;
    }

    clickTarget.click();
    return {
      clicked: true,
      buttonCandidateCount: candidates.length,
      visibleCandidateCount,
      matchedText: shortenDebugText(text),
      matchedTagName: lowerTagName(element),
      clickTargetTagName: lowerTagName(clickTarget)
    };
  }

  return {
    clicked: false,
    buttonCandidateCount: candidates.length,
    visibleCandidateCount,
    matchedText: null,
    matchedTagName: null,
    clickTargetTagName: null
  };
}

function closeYouTubeTranscriptPanel(): TranscriptPanelCloseResult {
  if (
    countTranscriptSegmentElements() === 0 &&
    countTranscriptPanelElements() === 0
  ) {
    return {
      closed: false,
      closeMethod: "close-not-needed",
      buttonCandidateCount: 0,
      visibleCandidateCount: 0,
      matchedText: null,
      matchedTagName: null,
      clickTargetTagName: null
    };
  }

  const closeClick = clickButtonMatchingText(CLOSE_TRANSCRIPT_PANEL_TEXT_PATTERN);

  return {
    ...closeClick,
    closed: closeClick.clicked,
    closeMethod: closeClick.clicked ? "close-button" : "close-not-found"
  };
}

function findTranscriptClickTarget(
  element: Element
): (HTMLElement & { click?: () => void }) | null {
  if (isInteractiveClickTarget(element)) {
    return element as HTMLElement & { click?: () => void };
  }

  const nestedTarget = element.querySelector(TRANSCRIPT_CLICK_TARGET_SELECTOR);

  return nestedTarget
    ? (nestedTarget as HTMLElement & { click?: () => void })
    : null;
}

function isInteractiveClickTarget(element: Element): boolean {
  const tagName = lowerTagName(element);

  return (
    tagName === "button" ||
    tagName === "a" ||
    element.getAttribute("role") === "button"
  );
}

function isVisibleForClick(element: Element): boolean {
  const htmlElement = element as HTMLElement;

  if (
    typeof window !== "undefined" &&
    typeof window.getComputedStyle === "function"
  ) {
    const style = window.getComputedStyle(htmlElement);

    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
  }

  if (typeof htmlElement.getClientRects === "function") {
    return htmlElement.getClientRects().length > 0;
  }

  return true;
}

function countTranscriptSegmentElements(): number {
  return document.querySelectorAll(TRANSCRIPT_SEGMENT_SELECTOR).length;
}

function countTranscriptPanelElements(): number {
  return document.querySelectorAll(
    [
      "ytd-transcript-renderer",
      "ytd-transcript-search-panel-renderer",
      "ytd-transcript-segment-list-renderer",
      "yt-transcript-renderer",
      "yt-section-list-renderer",
      'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]'
    ].join(", ")
  ).length;
}

function shortenDebugText(text: string): string {
  return formattedTranscriptPanelText(text).slice(0, 120);
}

function lowerTagName(element: Element): string | null {
  return element.tagName?.toLowerCase() ?? null;
}

function findTranscriptSegmentTimestamp(segment: Element): string {
  return (
    segment.querySelector(
      ".segment-timestamp, #segment-start-offset, #cue-group-start-offset, .ytwTranscriptSegmentViewModelTimestamp, [class*='timestamp']"
    )?.textContent ?? ""
  );
}

function findTranscriptSegmentText(segment: Element): string {
  return (
    segment.querySelector(
      ".segment-text, #segment-text, span[role='text'], .ytAttributedStringHost, yt-formatted-string, [class*='segment-text']"
    )?.textContent ?? ""
  );
}

function formattedTranscriptPanelText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function parseTimestampToMilliseconds(value: string): number | null {
  const parts = value
    .trim()
    .split(":")
    .map((part) => Number(part));

  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some((part) => !Number.isFinite(part))
  ) {
    return null;
  }

  return parts.reduce((total, part) => total * 60 + part, 0) * 1000;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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
