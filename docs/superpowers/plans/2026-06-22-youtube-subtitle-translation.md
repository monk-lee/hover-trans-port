# YouTube Subtitle Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add YouTube-provided caption and automatic-caption pre-translation, local subtitle caching, and synchronized translated subtitle overlay in the YouTube player.

**Architecture:** Implement this as a YouTube-only vertical feature beside the existing hover and selection translation path. The content script owns YouTube page observation, caption selection, transcript fetch, prompt UI, and subtitle overlay; the background owns option normalization and native messaging; the Rust native helper owns subtitle cache, chunking, provider execution, structured output validation, and cache writes.

**Tech Stack:** Chrome MV3 content scripts and service worker, TypeScript shared message types, Vite build, Node-based check scripts, Rust native helper with serde/rusqlite tests, existing local CLI providers.

---

## Scope Check

This is one vertical feature, not several independent products. The implementation crosses content UI, background/native protocol, and native helper storage because one user action must flow through all of them. Keep each task independently testable and commit after each task.

## File Structure

### New TypeScript Files

- `src/shared/youtubeSubtitles.ts`
  - Shared cue, track, cache-key, request, response, normalization, timeline hash, and chunk-plan types used by content and background.
- `src/content/youtubeCaptionTracks.ts`
  - Extract caption tracks from YouTube player response objects and choose one deterministic track.
- `src/content/youtubeTranscriptFetch.ts`
  - Fetch a selected transcript URL and normalize JSON3/XML timed-text responses into cues.
- `src/content/youtubeSubtitleControl.ts`
  - Mount the compact `.ytp-right-controls-left` control, prompt popover, spinner, unavailable state, error state, and callbacks.
- `src/content/youtubeSubtitleOverlay.ts`
  - Render the active translated cue over the YouTube player and keep it synced to `video.currentTime`.
- `src/content/youtubeSubtitleSession.ts`
  - Coordinate page observation, track selection, transcript hash, cache lookup, prompt decisions, translation request, stale response checks, and overlay activation.

### Modified TypeScript Files

- `src/content/content-script.ts`
  - Start YouTube subtitle session only on YouTube watch pages.
- `src/shared/messages.ts`
  - Add extension request and response types for subtitle cache lookup and translation.
- `src/shared/nativeProtocol.ts`
  - Add native request and response types for subtitle cache lookup and subtitle translation.
- `src/background/nativeClient.ts`
  - Add native host functions for subtitle cache lookup and translation using existing provider/options normalization.
- `src/background/service-worker.ts`
  - Route subtitle extension messages to the new native client functions.
- `package.json`
  - Add Node check scripts to `verify`.

### New Check Scripts

- `scripts/youtube-subtitles-shared-check.mjs`
- `scripts/youtube-caption-tracks-check.mjs`
- `scripts/youtube-transcript-fetch-check.mjs`
- `scripts/youtube-subtitle-ui-check.mjs`
- `scripts/youtube-subtitle-session-check.mjs`
- `scripts/youtube-subtitle-protocol-check.mjs`

### New Rust Files

- `native-helper/src/subtitles.rs`
  - Subtitle cue/request/response structs, prompt construction, output validation, chunk planning, and source timeline hash helpers.
- `native-helper/src/subtitle_cache.rs`
  - SQLite subtitle cache table, lookup, write, and clear helpers using the existing cache path.

### Modified Rust Files

- `native-helper/src/lib.rs`
  - Export `subtitles` and `subtitle_cache`.
- `native-helper/src/messages.rs`
  - Add `GetSubtitleTranslationCacheRequest` and `TranslateSubtitlesRequest`.
- `native-helper/src/bridge.rs`
  - Route `GET_SUBTITLE_TRANSLATION_CACHE` and `TRANSLATE_SUBTITLES`; clear subtitle cache from `CLEAR_TRANSLATION_CACHE`.
- `native-helper/src/providers/mod.rs`
  - Add provider prompt execution abstraction.
- `native-helper/src/providers/codex.rs`
- `native-helper/src/providers/claude.rs`
- `native-helper/src/providers/gemini.rs`
- `native-helper/src/providers/opencode.rs`
- `native-helper/src/providers/antigravity.rs`
  - Refactor provider-specific CLI execution so plain text translation and subtitle JSON prompts both use the same command runner.

### New/Modified Rust Tests

- `native-helper/tests/subtitle_tests.rs`
- `native-helper/tests/subtitle_cache_tests.rs`
- `native-helper/tests/provider_command_tests.rs`
- `native-helper/tests/bridge_tests.rs`

### Documentation

- `README.md`
- `readmes/README.ko.md`
- `PRIVACY.md`
- `docs/native-host-install.md`

---

## Task 1: Shared Subtitle Types, Normalization, Hashing, And Chunk Planning

**Files:**
- Create: `src/shared/youtubeSubtitles.ts`
- Create: `scripts/youtube-subtitles-shared-check.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing check script**

Create `scripts/youtube-subtitles-shared-check.mjs` with this test shape:

```js
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

function fail(message) {
  console.error(`youtube-subtitles-shared-check: ${message}`);
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

const tempDir = mkdtempSync(join(tmpdir(), "hover-trans-port-youtube-subtitles-"));
const tempSharedDir = join(tempDir, "src/shared");
mkdirSync(tempSharedDir, { recursive: true });
writeFileSync(
  join(tempSharedDir, "youtubeSubtitles.js"),
  transpile("src/shared/youtubeSubtitles.ts")
);

try {
  const subtitles = await import(pathToFileURL(join(tempSharedDir, "youtubeSubtitles.js")).href);
  const cues = subtitles.normalizeSubtitleCues([
    { id: "b", startMs: 2000, endMs: 3000, text: "  second\nline " },
    { id: "a", startMs: 0, endMs: 1200, text: "Hello   world" },
    { id: "empty", startMs: 3500, endMs: 3600, text: "   " }
  ]);

  assert(cues.length === 2, "blank cues should be removed");
  assert(cues[0].id === "a", "cues should sort by start time");
  assert(cues[0].text === "Hello world", "cue text should normalize whitespace");
  assert(cues[1].text === "second line", "multiline cue text should normalize whitespace");

  const hashA = subtitles.createSubtitleSourceTimelineHash(cues);
  const hashB = subtitles.createSubtitleSourceTimelineHash([
    { id: "a", startMs: 0, endMs: 1200, text: "Hello world!" },
    { id: "b", startMs: 2000, endMs: 3000, text: "second line" }
  ]);
  assert(hashA !== hashB, "timeline hash should change when source text changes");

  const chunks = subtitles.planSubtitleChunks(
    Array.from({ length: 81 }, (_, index) => ({
      id: `cue-${index}`,
      startMs: index * 1000,
      endMs: index * 1000 + 800,
      text: "short cue"
    }))
  );
  assert(chunks.length === 2, "81 cues should split at the 80 cue limit");
  assert(chunks[0].cues.length === 80, "first chunk should hold 80 cues");
  assert(chunks[1].cues.length === 1, "second chunk should hold remaining cue");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run the check and verify it fails**

Run: `node scripts/youtube-subtitles-shared-check.mjs`

Expected: FAIL because `src/shared/youtubeSubtitles.ts` does not exist.

- [ ] **Step 3: Implement shared subtitle utilities**

Create `src/shared/youtubeSubtitles.ts` with these exported types and functions:

```ts
import type { ProviderId, ProviderSelection } from "./providers";

export const SUBTITLE_TRANSLATION_PROMPT_VERSION = 1;
export const SUBTITLE_CHUNK_MAX_CUES = 80;
export const SUBTITLE_CHUNK_MAX_SOURCE_CHARS = 6000;

export type YouTubeCaptionTrackKind = "manual" | "asr";

export type YouTubeCaptionTrack = {
  id: string;
  languageCode: string;
  displayName: string;
  kind: YouTubeCaptionTrackKind;
  baseUrl: string;
};

export type YouTubeSubtitleCue = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
};

export type TranslatedSubtitleCue = {
  id: string;
  startMs: number;
  endMs: number;
  translatedText: string;
};

export type SubtitleCacheKeyInput = {
  videoId: string;
  sourceTrack: YouTubeCaptionTrack;
  sourceTimelineHash: string;
  targetLang: string;
  provider: ProviderSelection;
  model: string;
  promptVersion?: number;
};

export type SubtitleChunk = {
  index: number;
  cues: YouTubeSubtitleCue[];
};

export function normalizeSubtitleText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export function normalizeSubtitleCues(cues: YouTubeSubtitleCue[]): YouTubeSubtitleCue[] {
  return cues
    .map((cue) => ({
      id: cue.id.trim(),
      startMs: Math.max(0, Math.round(cue.startMs)),
      endMs: Math.max(0, Math.round(cue.endMs)),
      text: normalizeSubtitleText(cue.text)
    }))
    .filter((cue) => cue.id.length > 0 && cue.endMs > cue.startMs && cue.text.length > 0)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs || left.id.localeCompare(right.id));
}

function fnv1a(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createSubtitleSourceTimeline(cues: YouTubeSubtitleCue[]): string {
  return normalizeSubtitleCues(cues)
    .map((cue) => `${cue.id}\t${cue.startMs}\t${cue.endMs}\t${cue.text}`)
    .join("\n");
}

export function createSubtitleSourceTimelineHash(cues: YouTubeSubtitleCue[]): string {
  const timeline = createSubtitleSourceTimeline(cues);
  return `${timeline.length}:${fnv1a(timeline)}`;
}

export function createSubtitleTrackIdentity(track: YouTubeCaptionTrack): string {
  const raw = [
    track.languageCode.trim().toLowerCase(),
    track.kind,
    normalizeSubtitleText(track.displayName),
    track.baseUrl.trim()
  ].join("\n");
  return `${raw.length}:${fnv1a(raw)}`;
}

export function planSubtitleChunks(cues: YouTubeSubtitleCue[]): SubtitleChunk[] {
  const normalized = normalizeSubtitleCues(cues);
  const chunks: SubtitleChunk[] = [];
  let current: YouTubeSubtitleCue[] = [];
  let currentChars = 0;

  for (const cue of normalized) {
    const cueChars = cue.text.length;
    const wouldExceedCount = current.length >= SUBTITLE_CHUNK_MAX_CUES;
    const wouldExceedChars =
      current.length > 0 && currentChars + cueChars > SUBTITLE_CHUNK_MAX_SOURCE_CHARS;

    if (wouldExceedCount || wouldExceedChars) {
      chunks.push({ index: chunks.length, cues: current });
      current = [];
      currentChars = 0;
    }

    current.push(cue);
    currentChars += cueChars;
  }

  if (current.length > 0) {
    chunks.push({ index: chunks.length, cues: current });
  }

  return chunks;
}
```

- [ ] **Step 4: Add package script**

Add this script to `package.json`:

```json
"youtube-subtitles-shared:check": "node scripts/youtube-subtitles-shared-check.mjs"
```

Add it into `verify` after `translatable-element:check`.

- [ ] **Step 5: Run the check and typecheck**

Run: `pnpm youtube-subtitles-shared:check`

Expected: PASS with no output.

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/youtube-subtitles-shared-check.mjs src/shared/youtubeSubtitles.ts
git commit -m "feat: add youtube subtitle shared utilities"
```

---

## Task 2: YouTube Caption Track Extraction And Selection

**Files:**
- Create: `src/content/youtubeCaptionTracks.ts`
- Create: `scripts/youtube-caption-tracks-check.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing check**

Create `scripts/youtube-caption-tracks-check.mjs` that transpiles `src/content/youtubeCaptionTracks.ts` and `src/shared/youtubeSubtitles.ts`, then verifies:

```js
const playerResponse = {
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: "https://www.youtube.com/api/timedtext?v=abc&lang=en",
          languageCode: "en",
          name: { simpleText: "English" },
          vssId: ".en"
        },
        {
          baseUrl: "https://www.youtube.com/api/timedtext?v=abc&lang=ko&kind=asr",
          languageCode: "ko",
          name: { runs: [{ text: "Korean auto" }] },
          kind: "asr",
          vssId: "a.ko"
        }
      ]
    }
  }
};

const tracks = extractCaptionTracksFromPlayerResponse(playerResponse);
assert(tracks.length === 2, "two caption tracks should be extracted");
assert(tracks[0].kind === "manual", "missing kind should become manual");
assert(tracks[1].kind === "asr", "asr kind should be preserved");

const selectedForKorean = selectCaptionTrack({
  tracks,
  targetLang: "Korean"
});
assert(selectedForKorean?.languageCode === "en", "manual non-target language track should win");

const selectedActive = selectCaptionTrack({
  tracks,
  activeLanguageCode: "ko",
  activeKind: "asr",
  targetLang: "English"
});
assert(selectedActive?.languageCode === "ko", "active track should win when fetchable");
```

- [ ] **Step 2: Run the check and verify it fails**

Run: `node scripts/youtube-caption-tracks-check.mjs`

Expected: FAIL because `youtubeCaptionTracks.ts` does not exist.

- [ ] **Step 3: Implement extraction and selection**

Create `src/content/youtubeCaptionTracks.ts` with:

```ts
import type { YouTubeCaptionTrack, YouTubeCaptionTrackKind } from "../shared/youtubeSubtitles";
import { createSubtitleTrackIdentity, normalizeSubtitleText } from "../shared/youtubeSubtitles";

type SelectCaptionTrackInput = {
  tracks: YouTubeCaptionTrack[];
  activeLanguageCode?: string;
  activeKind?: YouTubeCaptionTrackKind;
  targetLang: string;
};

const TARGET_LANG_TO_CODE: Record<string, string> = {
  korean: "ko",
  english: "en",
  japanese: "ja",
  chinese: "zh",
  spanish: "es"
};

export function targetLangToLanguageCode(targetLang: string): string {
  return TARGET_LANG_TO_CODE[targetLang.trim().toLowerCase()] ?? targetLang.trim().toLowerCase();
}

function captionName(track: unknown): string {
  const value = track as { name?: { simpleText?: string; runs?: Array<{ text?: string }> } };
  return (
    value.name?.simpleText ??
    value.name?.runs?.map((run) => run.text ?? "").join("") ??
    ""
  );
}

export function extractCaptionTracksFromPlayerResponse(playerResponse: unknown): YouTubeCaptionTrack[] {
  const tracks =
    (playerResponse as {
      captions?: {
        playerCaptionsTracklistRenderer?: {
          captionTracks?: unknown[];
        };
      };
    })?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

  return tracks
    .map((track, index): YouTubeCaptionTrack | null => {
      const raw = track as {
        baseUrl?: string;
        languageCode?: string;
        kind?: string;
        vssId?: string;
      };
      const baseUrl = raw.baseUrl?.trim();
      const languageCode = raw.languageCode?.trim();
      if (!baseUrl || !languageCode) {
        return null;
      }
      const kind: YouTubeCaptionTrackKind = raw.kind === "asr" ? "asr" : "manual";
      const candidate = {
        id: raw.vssId?.trim() || `${languageCode}:${kind}:${index}`,
        languageCode,
        displayName: normalizeSubtitleText(captionName(track)) || languageCode,
        kind,
        baseUrl
      };
      return { ...candidate, id: candidate.id || createSubtitleTrackIdentity(candidate) };
    })
    .filter((track): track is YouTubeCaptionTrack => track !== null);
}

export function selectCaptionTrack(input: SelectCaptionTrackInput): YouTubeCaptionTrack | null {
  const tracks = input.tracks.filter((track) => track.baseUrl.trim().length > 0);
  const targetCode = targetLangToLanguageCode(input.targetLang);
  const active = tracks.find(
    (track) =>
      input.activeLanguageCode &&
      track.languageCode.toLowerCase() === input.activeLanguageCode.toLowerCase() &&
      (!input.activeKind || track.kind === input.activeKind)
  );
  if (active) {
    return active;
  }
  return (
    tracks.find((track) => track.kind === "manual" && track.languageCode.toLowerCase() !== targetCode) ??
    tracks.find((track) => track.kind === "asr" && track.languageCode.toLowerCase() !== targetCode) ??
    tracks.find((track) => track.kind === "manual") ??
    tracks.find((track) => track.kind === "asr") ??
    null
  );
}
```

- [ ] **Step 4: Add package script and verify**

Add:

```json
"youtube-caption-tracks:check": "node scripts/youtube-caption-tracks-check.mjs"
```

Add it into `verify` after `youtube-subtitles-shared:check`.

Run: `pnpm youtube-caption-tracks:check`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/youtube-caption-tracks-check.mjs src/content/youtubeCaptionTracks.ts
git commit -m "feat: add youtube caption track selection"
```

---

## Task 3: Transcript Fetch And Timed-Text Parsing

**Files:**
- Create: `src/content/youtubeTranscriptFetch.ts`
- Create: `scripts/youtube-transcript-fetch-check.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing parser check**

Create `scripts/youtube-transcript-fetch-check.mjs` with checks for JSON3 and XML parsing:

```js
const json3 = JSON.stringify({
  events: [
    { tStartMs: 0, dDurationMs: 1200, segs: [{ utf8: "Hello" }, { utf8: " world" }] },
    { tStartMs: 1400, dDurationMs: 600, segs: [{ utf8: "\n" }] },
    { tStartMs: 2200, dDurationMs: 900, segs: [{ utf8: "Bye" }] }
  ]
});
const jsonCues = parseYouTubeJson3Transcript(json3);
assert(jsonCues.length === 2, "blank JSON3 cue should be removed");
assert(jsonCues[0].id === "cue-0", "JSON3 cue ids should be deterministic");
assert(jsonCues[0].text === "Hello world", "JSON3 cue text should join segments");

const xml = `<transcript><text start="1.5" dur="2">Tom &amp; Jerry</text></transcript>`;
const xmlCues = parseYouTubeXmlTranscript(xml);
assert(xmlCues.length === 1, "XML cue should parse");
assert(xmlCues[0].startMs === 1500, "XML start seconds should become milliseconds");
assert(xmlCues[0].endMs === 3500, "XML duration seconds should become end milliseconds");
assert(xmlCues[0].text === "Tom & Jerry", "XML entities should decode");
```

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/youtube-transcript-fetch-check.mjs`

Expected: FAIL because `youtubeTranscriptFetch.ts` does not exist.

- [ ] **Step 3: Implement parsers and fetch helper**

Create `src/content/youtubeTranscriptFetch.ts` with:

```ts
import type { YouTubeCaptionTrack, YouTubeSubtitleCue } from "../shared/youtubeSubtitles";
import { normalizeSubtitleCues } from "../shared/youtubeSubtitles";

export function withJson3Format(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("fmt", "json3");
  return url.toString();
}

export function parseYouTubeJson3Transcript(text: string): YouTubeSubtitleCue[] {
  const value = JSON.parse(text) as { events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }> };
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

export async function fetchYouTubeTranscript(track: YouTubeCaptionTrack): Promise<YouTubeSubtitleCue[]> {
  const response = await fetch(withJson3Format(track.baseUrl), { credentials: "omit" });
  if (!response.ok) {
    throw new Error(`YouTube transcript request failed with HTTP ${response.status}.`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  return contentType.includes("json") || text.trim().startsWith("{")
    ? parseYouTubeJson3Transcript(text)
    : parseYouTubeXmlTranscript(text);
}
```

- [ ] **Step 4: Add fake DOM parser support in the check**

In `scripts/youtube-transcript-fetch-check.mjs`, define `global.document` and `global.DOMParser` if Node does not provide them. Use a minimal fake that supports the XML fixture above.

- [ ] **Step 5: Add script and verify**

Add:

```json
"youtube-transcript-fetch:check": "node scripts/youtube-transcript-fetch-check.mjs"
```

Add it into `verify` after `youtube-caption-tracks:check`.

Run: `pnpm youtube-transcript-fetch:check`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/youtube-transcript-fetch-check.mjs src/content/youtubeTranscriptFetch.ts
git commit -m "feat: parse youtube subtitle transcripts"
```

---

## Task 4: YouTube Player Control And Overlay

**Files:**
- Create: `src/content/youtubeSubtitleControl.ts`
- Create: `src/content/youtubeSubtitleOverlay.ts`
- Create: `scripts/youtube-subtitle-ui-check.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing UI check**

Create `scripts/youtube-subtitle-ui-check.mjs` with fake DOM classes like `scripts/inline-renderer-check.mjs`. Verify:

```js
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
assert(controls.children[1].getAttribute("data-hover-trans-port-youtube-subtitle-control") === "true", "control should mount between subtitle and settings buttons");

control.setState({ status: "loading", message: "번역 중..." });
assert(controls.textContent.includes("번역 중"), "loading label should render");

control.mount(controls);
assert(findAllControls(controls).length === 1, "control mount should be idempotent");

const overlay = new YouTubeSubtitleOverlay();
overlay.mount(document.body);
overlay.setCues([{ id: "a", startMs: 0, endMs: 1000, translatedText: "안녕" }]);
overlay.update(0.5);
assert(document.body.textContent.includes("안녕"), "overlay should show active cue");
overlay.update(2);
assert(!document.body.textContent.includes("안녕"), "overlay should hide inactive cue");
```

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/youtube-subtitle-ui-check.mjs`

Expected: FAIL because UI modules do not exist.

- [ ] **Step 3: Implement `YouTubeSubtitleControl`**

Create `src/content/youtubeSubtitleControl.ts` with:

```ts
export type YouTubeSubtitleControlState =
  | { status: "prompt" }
  | { status: "loading"; message: string }
  | { status: "enabled" }
  | { status: "disabled" }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

type YouTubeSubtitleControlHandlers = {
  onAccept: () => void;
  onDecline: () => void;
  onToggle: () => void;
};

const CONTROL_ATTRIBUTE = "data-hover-trans-port-youtube-subtitle-control";
const POPOVER_ATTRIBUTE = "data-hover-trans-port-youtube-subtitle-popover";

export class YouTubeSubtitleControl {
  private node: HTMLButtonElement | null = null;
  private popover: HTMLElement | null = null;

  constructor(private readonly handlers: YouTubeSubtitleControlHandlers) {}

  mount(container: Element): void {
    const existing = container.querySelector<HTMLButtonElement>(`[${CONTROL_ATTRIBUTE}="true"]`);
    this.node = existing ?? document.createElement("button");
    this.node.className = "ytp-button hover-trans-port-youtube-subtitle-control";
    this.node.setAttribute(CONTROL_ATTRIBUTE, "true");
    this.node.type = "button";
    this.node.onclick = () => this.handleClick();

    if (!existing) {
      const settings = container.querySelector(".ytp-settings-button");
      container.insertBefore(this.node, settings);
    }
  }

  setState(state: YouTubeSubtitleControlState): void {
    if (!this.node) {
      return;
    }
    this.node.dataset.hoverTransPortStatus = state.status;
    this.node.textContent =
      state.status === "loading"
        ? state.message
        : state.status === "enabled"
          ? "번역"
          : state.status === "disabled"
            ? "번역"
            : "번역?";
    if (state.status !== "prompt") {
      this.hidePopover();
    }
  }

  private handleClick(): void {
    this.showPrompt();
  }

  private showPrompt(): void {
    this.hidePopover();
    const popover = document.createElement("div");
    popover.setAttribute(POPOVER_ATTRIBUTE, "true");
    popover.className = "hover-trans-port-youtube-subtitle-popover notranslate";
    popover.textContent = "자막 번역할까요? ";
    const yes = document.createElement("button");
    yes.type = "button";
    yes.textContent = "예";
    yes.onclick = () => {
      this.hidePopover();
      this.handlers.onAccept();
    };
    const no = document.createElement("button");
    no.type = "button";
    no.textContent = "아니오";
    no.onclick = () => {
      this.hidePopover();
      this.handlers.onDecline();
    };
    popover.append(yes, no);
    this.node?.after(popover);
    this.popover = popover;
  }

  private hidePopover(): void {
    this.popover?.remove();
    this.popover = null;
  }
}
```

- [ ] **Step 4: Implement `YouTubeSubtitleOverlay`**

Create `src/content/youtubeSubtitleOverlay.ts` with:

```ts
import type { TranslatedSubtitleCue } from "../shared/youtubeSubtitles";

const OVERLAY_ATTRIBUTE = "data-hover-trans-port-youtube-subtitle-overlay";

export class YouTubeSubtitleOverlay {
  private node: HTMLElement | null = null;
  private cues: TranslatedSubtitleCue[] = [];

  mount(playerRoot: Element): void {
    const existing = playerRoot.querySelector<HTMLElement>(`[${OVERLAY_ATTRIBUTE}="true"]`);
    this.node = existing ?? document.createElement("div");
    this.node.setAttribute(OVERLAY_ATTRIBUTE, "true");
    this.node.className = "hover-trans-port-youtube-subtitle-overlay notranslate";
    if (!existing) {
      playerRoot.appendChild(this.node);
    }
  }

  setCues(cues: TranslatedSubtitleCue[]): void {
    this.cues = [...cues].sort((left, right) => left.startMs - right.startMs);
  }

  update(currentTimeSeconds: number): void {
    if (!this.node) {
      return;
    }
    const currentMs = Math.round(currentTimeSeconds * 1000);
    const cue = this.cues.find((candidate) => currentMs >= candidate.startMs && currentMs < candidate.endMs);
    this.node.textContent = cue?.translatedText ?? "";
    this.node.hidden = !cue;
  }

  clear(): void {
    this.cues = [];
    if (this.node) {
      this.node.textContent = "";
      this.node.hidden = true;
    }
  }
}
```

- [ ] **Step 5: Add CSS in the modules**

Insert one `<style>` element with a stable id from each UI module. Keep CSS scoped to `hover-trans-port-youtube-subtitle-*`, use stable dimensions, and do not put long prompt text directly in the control bar.

- [ ] **Step 6: Add script and verify**

Add:

```json
"youtube-subtitle-ui:check": "node scripts/youtube-subtitle-ui-check.mjs"
```

Add it into `verify` after `youtube-transcript-fetch:check`.

Run: `pnpm youtube-subtitle-ui:check`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json scripts/youtube-subtitle-ui-check.mjs src/content/youtubeSubtitleControl.ts src/content/youtubeSubtitleOverlay.ts
git commit -m "feat: add youtube subtitle player UI"
```

---

## Task 5: Content Session Orchestration

**Files:**
- Create: `src/content/youtubeSubtitleSession.ts`
- Create: `scripts/youtube-subtitle-session-check.mjs`
- Modify: `src/content/content-script.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing session check**

Create `scripts/youtube-subtitle-session-check.mjs`. Use fake DOM and fake `chrome.runtime.sendMessage`. Verify:

```js
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
          cues: [{ id: "cue-0", startMs: 0, endMs: 1000, translatedText: "안녕" }]
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

const session = new YouTubeSubtitleSession({
  getPlayerResponse: () => playerResponseFixture,
  fetchTranscript: async () => [{ id: "cue-0", startMs: 0, endMs: 1000, text: "Hello" }]
});
await session.refresh();
assert(sentMessages[0].type === "GET_SUBTITLE_TRANSLATION_CACHE", "session should check cache after transcript hash exists");
await session.acceptTranslation();
assert(sentMessages.some((message) => message.type === "TRANSLATE_SUBTITLE_TRACK"), "accept should request subtitle translation");
```

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/youtube-subtitle-session-check.mjs`

Expected: FAIL because `youtubeSubtitleSession.ts` does not exist.

- [ ] **Step 3: Implement session**

Create `src/content/youtubeSubtitleSession.ts` with:

```ts
import type { ExtensionRequest, ExtensionResponse } from "../shared/messages";
import { getBrowserTargetLang, getModelForProvider, normalizeProvider, normalizeTargetLang, type StoredOptions } from "../shared/options";
import { createSubtitleSourceTimelineHash, createSubtitleTrackIdentity, type TranslatedSubtitleCue, type YouTubeSubtitleCue } from "../shared/youtubeSubtitles";
import { extractCaptionTracksFromPlayerResponse, selectCaptionTrack } from "./youtubeCaptionTracks";
import { fetchYouTubeTranscript } from "./youtubeTranscriptFetch";
import { YouTubeSubtitleControl } from "./youtubeSubtitleControl";
import { YouTubeSubtitleOverlay } from "./youtubeSubtitleOverlay";

type SessionDeps = {
  getPlayerResponse?: () => unknown;
  fetchTranscript?: typeof fetchYouTubeTranscript;
};

export class YouTubeSubtitleSession {
  private readonly declinedVideoIds = new Set<string>();
  private readonly control = new YouTubeSubtitleControl({
    onAccept: () => void this.acceptTranslation(),
    onDecline: () => this.declineTranslation(),
    onToggle: () => this.toggleOverlay()
  });
  private readonly overlay = new YouTubeSubtitleOverlay();
  private current:
    | {
        videoId: string;
        cues: YouTubeSubtitleCue[];
        sourceTimelineHash: string;
        sourceTrackIdentity: string;
      }
    | null = null;

  constructor(private readonly deps: SessionDeps = {}) {}

  async refresh(): Promise<void> {
    const videoId = new URL(location.href).searchParams.get("v");
    const controls = document.querySelector(".ytp-right-controls-left");
    const playerRoot = document.querySelector(".html5-video-player") ?? document.body;
    const video = document.querySelector("video");
    if (!videoId || !controls || !video) {
      return;
    }
    this.control.mount(controls);
    this.overlay.mount(playerRoot);

    const options = (await chrome.storage.local.get("hoverTransPort")) as StoredOptions;
    const provider = normalizeProvider(options.hoverTransPort?.provider);
    const targetLang = normalizeTargetLang(options.hoverTransPort?.targetLang, getBrowserTargetLang([navigator.language]));
    const model = getModelForProvider(options.hoverTransPort, provider);

    const tracks = extractCaptionTracksFromPlayerResponse(this.deps.getPlayerResponse?.() ?? readYouTubePlayerResponse());
    const track = selectCaptionTrack({ tracks, targetLang });
    if (!track) {
      this.control.setState({ status: "unavailable", message: "사용 가능한 YouTube 자막이 없습니다." });
      return;
    }

    const cues = await (this.deps.fetchTranscript ?? fetchYouTubeTranscript)(track);
    const sourceTimelineHash = createSubtitleSourceTimelineHash(cues);
    const sourceTrackIdentity = createSubtitleTrackIdentity(track);
    this.current = { videoId, cues, sourceTimelineHash, sourceTrackIdentity };

    const requestId = createRequestId();
    const response = await chrome.runtime.sendMessage<ExtensionRequest, ExtensionResponse>({
      type: "GET_SUBTITLE_TRANSLATION_CACHE",
      requestId,
      videoId,
      sourceTrackIdentity,
      sourceTimelineHash,
      targetLang,
      provider,
      model
    });

    if (response.type === "SUBTITLE_TRANSLATION_CACHE_RESULT" && response.ok && response.cached) {
      this.activate(response.cues);
      return;
    }

    this.control.setState(this.declinedVideoIds.has(videoId) ? { status: "disabled" } : { status: "prompt" });
  }

  async acceptTranslation(): Promise<void> {
    if (!this.current) {
      return;
    }
    const video = document.querySelector("video");
    const wasPlaying = Boolean(video && !video.paused);
    video?.pause();
    this.control.setState({ status: "loading", message: "번역 중..." });
    const requestId = createRequestId();
    const response = await chrome.runtime.sendMessage<ExtensionRequest, ExtensionResponse>({
      type: "TRANSLATE_SUBTITLE_TRACK",
      requestId,
      ...this.current,
      cues: this.current.cues
    });
    if (response.type === "SUBTITLE_TRANSLATION_RESULT" && response.ok) {
      this.activate(response.cues);
      if (wasPlaying) {
        await video?.play().catch(() => undefined);
      }
    } else {
      this.control.setState({ status: "error", message: "자막 번역에 실패했습니다." });
    }
  }

  private activate(cues: TranslatedSubtitleCue[]): void {
    this.overlay.setCues(cues);
    this.control.setState({ status: "enabled" });
  }

  private declineTranslation(): void {
    if (this.current) {
      this.declinedVideoIds.add(this.current.videoId);
    }
    this.control.setState({ status: "disabled" });
  }

  private toggleOverlay(): void {
    this.overlay.clear();
    this.control.setState({ status: "disabled" });
  }
}

function createRequestId(): string {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random()}`;
}

function readYouTubePlayerResponse(): unknown {
  return (window as typeof window & { ytInitialPlayerResponse?: unknown })
    .ytInitialPlayerResponse ?? null;
}
```

- [ ] **Step 4: Start session from `content-script.ts`**

At the bottom of `src/content/content-script.ts`, after existing startup code, add:

```ts
if (location.hostname === "www.youtube.com" || location.hostname === "youtube.com") {
  import("./youtubeSubtitleSession")
    .then(({ startYouTubeSubtitleSession }) => {
      startYouTubeSubtitleSession();
    })
    .catch(() => undefined);
}
```

Export `startYouTubeSubtitleSession()` from `youtubeSubtitleSession.ts`. It creates one session, calls `refresh()`, and uses a `MutationObserver` plus `yt-navigate-finish` listener to call `refresh()` again.

- [ ] **Step 5: Add script and verify**

Add:

```json
"youtube-subtitle-session:check": "node scripts/youtube-subtitle-session-check.mjs"
```

Add it into `verify` after `youtube-subtitle-ui:check`.

Run: `pnpm youtube-subtitle-session:check`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/youtube-subtitle-session-check.mjs src/content/content-script.ts src/content/youtubeSubtitleSession.ts
git commit -m "feat: coordinate youtube subtitle translation session"
```

---

## Task 6: Extension And Native Protocol Types

**Files:**
- Modify: `src/shared/messages.ts`
- Modify: `src/shared/nativeProtocol.ts`
- Create: `scripts/youtube-subtitle-protocol-check.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing protocol check**

Create `scripts/youtube-subtitle-protocol-check.mjs` that reads `src/shared/messages.ts` and `src/shared/nativeProtocol.ts` and asserts they contain:

```js
[
  "GET_SUBTITLE_TRANSLATION_CACHE",
  "TRANSLATE_SUBTITLE_TRACK",
  "SUBTITLE_TRANSLATION_CACHE_RESULT",
  "SUBTITLE_TRANSLATION_RESULT",
  "TRANSLATE_SUBTITLES",
  "SUBTITLE_CACHE_RESULT",
  "SUBTITLE_TRANSLATE_RESULT"
]
```

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/youtube-subtitle-protocol-check.mjs`

Expected: FAIL because message types are not present.

- [ ] **Step 3: Add extension request and response types**

In `src/shared/messages.ts`, import subtitle types:

```ts
import type {
  TranslatedSubtitleCue,
  YouTubeSubtitleCue
} from "./youtubeSubtitles";
```

Add `SubtitleTranslationCacheResponse` and `SubtitleTranslationResultResponse` unions:

```ts
export type SubtitleTranslationCacheResponse =
  | {
      type: "SUBTITLE_TRANSLATION_CACHE_RESULT";
      requestId: string;
      ok: true;
      cached: true;
      cues: TranslatedSubtitleCue[];
    }
  | {
      type: "SUBTITLE_TRANSLATION_CACHE_RESULT";
      requestId: string;
      ok: true;
      cached: false;
    }
  | {
      type: "SUBTITLE_TRANSLATION_CACHE_RESULT";
      requestId: string;
      ok: false;
      error: "NATIVE_HOST_UNAVAILABLE" | "CACHE_ERROR" | "UNKNOWN_ERROR";
      message: string;
      retryable: boolean;
    };

export type SubtitleTranslationResultResponse =
  | {
      type: "SUBTITLE_TRANSLATION_RESULT";
      requestId: string;
      ok: true;
      provider: ProviderId;
      cues: TranslatedSubtitleCue[];
      cached: boolean;
      elapsedMs: number;
    }
  | {
      type: "SUBTITLE_TRANSLATION_RESULT";
      requestId: string;
      ok: false;
      provider?: ProviderId;
      error:
        | "NATIVE_HOST_UNAVAILABLE"
        | "NATIVE_HOST_UPDATE_REQUIRED"
        | "NATIVE_HOST_UNSUPPORTED"
        | "PROVIDER_NOT_FOUND"
        | "PROVIDER_TIMEOUT"
        | "PROVIDER_EXIT_NONZERO"
        | "PROVIDER_OUTPUT_PARSE_FAILED"
        | "CACHE_ERROR"
        | "UNKNOWN_ERROR";
      message: string;
      retryable: boolean;
      elapsedMs?: number;
    };
```

Add extension requests with the cache dimensions and cues. Add both response unions to `ExtensionResponse`.

- [ ] **Step 4: Add native protocol types**

In `src/shared/nativeProtocol.ts`, import subtitle types and add:

```ts
export type NativeSubtitleCacheRequest = {
  type: "GET_SUBTITLE_TRANSLATION_CACHE";
  requestId: string;
  provider?: ProviderSelection;
  model?: string;
  targetLang: string;
  videoId: string;
  sourceTrackIdentity: string;
  sourceTimelineHash: string;
  promptVersion: number;
};

export type NativeTranslateSubtitlesRequest = NativeSubtitleCacheRequest & {
  type: "TRANSLATE_SUBTITLES";
  cues: YouTubeSubtitleCue[];
  timeoutMs?: number;
  cacheEnabled?: boolean;
  debugLogging?: boolean;
};
```

Add result unions named `NativeSubtitleCacheResponse` and `NativeSubtitleTranslateResponse`, then include them in `NativeRequest` and `NativeResponse`.

- [ ] **Step 5: Verify**

Run: `pnpm youtube-subtitle-protocol:check`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/youtube-subtitle-protocol-check.mjs src/shared/messages.ts src/shared/nativeProtocol.ts
git commit -m "feat: add youtube subtitle protocol types"
```

---

## Task 7: Background Native Client And Service Worker Routing

**Files:**
- Modify: `src/background/nativeClient.ts`
- Modify: `src/background/service-worker.ts`
- Modify: `scripts/youtube-subtitle-protocol-check.mjs`

- [ ] **Step 1: Extend protocol check for service worker routing**

Update `scripts/youtube-subtitle-protocol-check.mjs` to assert:

```js
assert(read("src/background/service-worker.ts").includes("GET_SUBTITLE_TRANSLATION_CACHE"), "service worker should route subtitle cache requests");
assert(read("src/background/service-worker.ts").includes("TRANSLATE_SUBTITLE_TRACK"), "service worker should route subtitle translation requests");
assert(read("src/background/nativeClient.ts").includes("getSubtitleTranslationCache"), "native client should expose subtitle cache lookup");
assert(read("src/background/nativeClient.ts").includes("translateSubtitleTrack"), "native client should expose subtitle translation");
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm youtube-subtitle-protocol:check`

Expected: FAIL because routing functions are missing.

- [ ] **Step 3: Implement native client methods**

In `src/background/nativeClient.ts`, add `SubtitleCacheStatus` and `SubtitleTranslationStatus` types mirroring extension responses without `type`.

Add `getSubtitleTranslationCache(requestId, input)`:

```ts
export async function getSubtitleTranslationCache(
  requestId: string,
  input: {
    videoId: string;
    sourceTrackIdentity: string;
    sourceTimelineHash: string;
    targetLang: string;
    provider?: ProviderSelection;
    model?: string;
    promptVersion: number;
  }
): Promise<SubtitleCacheStatus> {
  const nativeHostStatus = await checkNativeHost(`${requestId}:host-info`);
  if (!nativeHostStatus.ok) {
    return { ok: false, error: "NATIVE_HOST_UNAVAILABLE", message: nativeHostStatus.message, retryable: nativeHostStatus.retryable };
  }
  const response = await sendNativeHostMessage({
    type: "GET_SUBTITLE_TRANSLATION_CACHE",
    requestId,
    provider: input.provider,
    model: input.model,
    targetLang: input.targetLang,
    videoId: input.videoId,
    sourceTrackIdentity: input.sourceTrackIdentity,
    sourceTimelineHash: input.sourceTimelineHash,
    promptVersion: input.promptVersion
  });
  if (
    response?.type === "SUBTITLE_CACHE_RESULT" &&
    response.requestId === requestId &&
    response.ok &&
    response.cached
  ) {
    return { ok: true, cached: true, cues: response.cues };
  }
  if (
    response?.type === "SUBTITLE_CACHE_RESULT" &&
    response.requestId === requestId &&
    response.ok &&
    !response.cached
  ) {
    return { ok: true, cached: false };
  }
  if (
    response?.type === "SUBTITLE_CACHE_RESULT" &&
    response.requestId === requestId &&
    !response.ok
  ) {
    return {
      ok: false,
      error: response.error === "CACHE_ERROR" ? "CACHE_ERROR" : "UNKNOWN_ERROR",
      message: response.message,
      retryable: response.retryable
    };
  }
  return {
    ok: false,
    error: "UNKNOWN_ERROR",
    message: "Native host returned an invalid subtitle cache response.",
    retryable: true
  };
}
```

Add `translateSubtitleTrack(requestId, input)` that loads options from `chrome.storage.local`, resolves provider/model/targetLang/timeout/cache/debug exactly like `translateWithNativeHost`, sends `TRANSLATE_SUBTITLES`, and uses timeout `(timeoutMsValue + NATIVE_TRANSLATION_OVERHEAD_MS) * Math.max(1, input.chunkCountEstimate ?? 1)`.

- [ ] **Step 4: Route service worker messages**

In `src/background/service-worker.ts`, import both functions. Add handlers:

```ts
if (message.type === "GET_SUBTITLE_TRANSLATION_CACHE") {
  void getSubtitleTranslationCache(message.requestId, message).then((result) => {
    sendResponse({ type: "SUBTITLE_TRANSLATION_CACHE_RESULT", requestId: message.requestId, ...result });
  });
  return true;
}

if (message.type === "TRANSLATE_SUBTITLE_TRACK") {
  void translateSubtitleTrack(message.requestId, message).then((result) => {
    sendResponse({ type: "SUBTITLE_TRANSLATION_RESULT", requestId: message.requestId, ...result });
  });
  return true;
}
```

- [ ] **Step 5: Verify**

Run: `pnpm youtube-subtitle-protocol:check`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/youtube-subtitle-protocol-check.mjs src/background/nativeClient.ts src/background/service-worker.ts
git commit -m "feat: route youtube subtitle messages"
```

---

## Task 8: Native Subtitle Models, Cache, Prompt, Chunking, And Validation

**Files:**
- Create: `native-helper/src/subtitles.rs`
- Create: `native-helper/src/subtitle_cache.rs`
- Create: `native-helper/tests/subtitle_tests.rs`
- Create: `native-helper/tests/subtitle_cache_tests.rs`
- Modify: `native-helper/src/lib.rs`
- Modify: `native-helper/src/cache.rs`

- [ ] **Step 1: Write failing Rust tests**

Create `native-helper/tests/subtitle_tests.rs`:

```rust
use hover_trans_port_helper::subtitles::{
    build_subtitle_translation_prompt, plan_subtitle_chunks, validate_subtitle_translation_output,
    SubtitleCue,
};

#[test]
fn chunk_plan_respects_count_and_character_limits() {
    let cues = (0..81)
        .map(|index| SubtitleCue {
            id: format!("cue-{index}"),
            start_ms: index * 1000,
            end_ms: index * 1000 + 800,
            text: "short cue".to_string(),
        })
        .collect::<Vec<_>>();

    let chunks = plan_subtitle_chunks(&cues);
    assert_eq!(chunks.len(), 2);
    assert_eq!(chunks[0].cues.len(), 80);
    assert_eq!(chunks[1].cues.len(), 1);
}

#[test]
fn prompt_requests_json_and_preserves_ids() {
    let prompt = build_subtitle_translation_prompt(
        &[SubtitleCue {
            id: "cue-1".to_string(),
            start_ms: 0,
            end_ms: 1000,
            text: "Hello".to_string(),
        }],
        "Korean",
    );

    assert!(prompt.contains("Return valid JSON only."));
    assert!(prompt.contains("cue-1"));
    assert!(prompt.contains("Do not merge, split, drop, or reorder cues."));
}

#[test]
fn validation_rejects_missing_duplicate_or_reordered_cues() {
    let source = vec![
        SubtitleCue { id: "a".to_string(), start_ms: 0, end_ms: 1000, text: "Hello".to_string() },
        SubtitleCue { id: "b".to_string(), start_ms: 1000, end_ms: 2000, text: "Bye".to_string() },
    ];

    let ok = validate_subtitle_translation_output(
        &source,
        r#"{"cues":[{"id":"a","translatedText":"안녕"},{"id":"b","translatedText":"잘 가"}]}"#,
    )
    .unwrap();
    assert_eq!(ok[0].translated_text, "안녕");

    assert!(validate_subtitle_translation_output(&source, r#"{"cues":[{"id":"a","translatedText":"안녕"}]}"#).is_err());
    assert!(validate_subtitle_translation_output(&source, r#"{"cues":[{"id":"b","translatedText":"잘 가"},{"id":"a","translatedText":"안녕"}]}"#).is_err());
}
```

Create `native-helper/tests/subtitle_cache_tests.rs` with write/lookup/clear tests using a temp SQLite path.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm helper:test -- subtitle_tests subtitle_cache_tests`

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement subtitle models and validation**

Create `native-helper/src/subtitles.rs`:

```rust
use serde::{Deserialize, Serialize};
use crate::process::ProviderError;

pub const SUBTITLE_TRANSLATION_PROMPT_VERSION: u64 = 1;
pub const SUBTITLE_CHUNK_MAX_CUES: usize = 80;
pub const SUBTITLE_CHUNK_MAX_SOURCE_CHARS: usize = 6000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleCue {
    pub id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslatedSubtitleCue {
    pub id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub translated_text: String,
}

#[derive(Clone, Debug)]
pub struct SubtitleChunk {
    pub index: usize,
    pub cues: Vec<SubtitleCue>,
}

pub fn plan_subtitle_chunks(cues: &[SubtitleCue]) -> Vec<SubtitleChunk> {
    let mut chunks = Vec::new();
    let mut current = Vec::new();
    let mut current_chars = 0_usize;

    for cue in cues.iter().cloned() {
        let cue_chars = cue.text.chars().count();
        let exceeds_count = current.len() >= SUBTITLE_CHUNK_MAX_CUES;
        let exceeds_chars =
            !current.is_empty() && current_chars + cue_chars > SUBTITLE_CHUNK_MAX_SOURCE_CHARS;

        if exceeds_count || exceeds_chars {
            chunks.push(SubtitleChunk {
                index: chunks.len(),
                cues: std::mem::take(&mut current),
            });
            current_chars = 0;
        }

        current_chars += cue_chars;
        current.push(cue);
    }

    if !current.is_empty() {
        chunks.push(SubtitleChunk {
            index: chunks.len(),
            cues: current,
        });
    }

    chunks
}

pub fn build_subtitle_translation_prompt(cues: &[SubtitleCue], target_lang: &str) -> String {
    let cue_input = cues
        .iter()
        .map(|cue| serde_json::json!({"id": cue.id, "text": cue.text}))
        .collect::<Vec<_>>();

    [
        format!("Translate each subtitle cue to {target_lang}."),
        "Return valid JSON only.".to_string(),
        "Use this exact shape: {\"cues\":[{\"id\":\"cue-id\",\"translatedText\":\"translated text\"}]}.".to_string(),
        "Preserve cue ids exactly.".to_string(),
        "Do not merge, split, drop, or reorder cues.".to_string(),
        "Do not include markdown fences.".to_string(),
        "Preserve names, numbers, product names, and on-screen terminology.".to_string(),
        String::new(),
        "Cues:".to_string(),
        serde_json::to_string(&serde_json::json!({"cues": cue_input})).unwrap_or_else(|_| "{\"cues\":[]}".to_string()),
    ]
    .join("\n")
}

pub fn validate_subtitle_translation_output(
    source: &[SubtitleCue],
    output: &str,
) -> Result<Vec<TranslatedSubtitleCue>, ProviderError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct OutputCue {
        id: String,
        translated_text: String,
    }

    #[derive(Deserialize)]
    struct Output {
        cues: Vec<OutputCue>,
    }

    let parsed = serde_json::from_str::<Output>(output).map_err(|error| {
        ProviderError::OutputParseFailed {
            message: error.to_string(),
        }
    })?;

    if parsed.cues.len() != source.len() {
        return Err(ProviderError::OutputParseFailed {
            message: "Subtitle output cue count did not match source cue count.".to_string(),
        });
    }

    source
        .iter()
        .zip(parsed.cues)
        .map(|(source, translated)| {
            if translated.id != source.id || translated.translated_text.trim().is_empty() {
                return Err(ProviderError::OutputParseFailed {
                    message: "Subtitle output cue ids or text were invalid.".to_string(),
                });
            }
            Ok(TranslatedSubtitleCue {
                id: source.id.clone(),
                start_ms: source.start_ms,
                end_ms: source.end_ms,
                translated_text: translated.translated_text.trim().to_string(),
            })
        })
        .collect()
}
```

- [ ] **Step 4: Implement subtitle cache**

Create `native-helper/src/subtitle_cache.rs` with a table:

```sql
CREATE TABLE IF NOT EXISTS subtitle_translation_cache (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  video_id TEXT NOT NULL,
  source_track_identity TEXT NOT NULL,
  source_timeline_hash TEXT NOT NULL,
  prompt_version INTEGER NOT NULL,
  source_cues_json TEXT NOT NULL,
  translated_cues_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (
    provider,
    model,
    target_lang,
    video_id,
    source_track_identity,
    source_timeline_hash,
    prompt_version
  )
);
```

Expose `lookup`, `write`, and `clear` methods.

- [ ] **Step 5: Export modules and update clear**

In `native-helper/src/lib.rs`, add:

```rust
pub mod subtitle_cache;
pub mod subtitles;
```

In `native-helper/src/cache.rs`, keep existing text cache behavior unchanged. Do not merge subtitle cache into the text cache table.

- [ ] **Step 6: Verify**

Run: `pnpm helper:test -- subtitle_tests subtitle_cache_tests`

Expected: PASS.

Run: `pnpm helper:test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add native-helper/src/lib.rs native-helper/src/subtitles.rs native-helper/src/subtitle_cache.rs native-helper/tests/subtitle_tests.rs native-helper/tests/subtitle_cache_tests.rs
git commit -m "feat: add native subtitle cache and validation"
```

---

## Task 9: Provider Prompt Execution Refactor

**Files:**
- Modify: `native-helper/src/providers/mod.rs`
- Modify: `native-helper/src/providers/codex.rs`
- Modify: `native-helper/src/providers/claude.rs`
- Modify: `native-helper/src/providers/gemini.rs`
- Modify: `native-helper/src/providers/opencode.rs`
- Modify: `native-helper/src/providers/antigravity.rs`
- Modify: `native-helper/tests/provider_command_tests.rs`

- [ ] **Step 1: Add failing provider prompt test**

In `native-helper/tests/provider_command_tests.rs`, add a test that uses the existing `echo-stdin` fixture or a provider fixture and asserts a raw prompt reaches the provider without being wrapped by `build_translate_prompt`.

Test shape:

```rust
#[test]
fn provider_prompt_request_sends_raw_prompt() {
    let codex = fixture_path("codex");
    make_executable(&codex);
    let temp = tempdir().unwrap();
    let mut env = BTreeMap::new();
    env.insert("HOVER_TRANS_PORT_CODEX_PATH".to_string(), codex.to_string_lossy().into_owned());
    env.insert("HOME".to_string(), temp.path().display().to_string());
    env.insert("PATH".to_string(), "/bin:/usr/bin".to_string());

    let registry = ProviderRegistry::new(env);
    let (_provider, result) = registry
        .run_prompt(
            Some("codex"),
            ProviderPromptRequest {
                prompt: "RAW_SUBTITLE_PROMPT".to_string(),
                model: None,
                timeout_ms: 30_000,
            },
        )
        .unwrap();

    assert!(result.text.contains("RAW_SUBTITLE_PROMPT"));
    assert!(!result.text.contains("Translate the following text"));
}
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm helper:test -- provider_prompt_request_sends_raw_prompt`

Expected: FAIL because `ProviderRegistry::run_prompt` is missing.

- [ ] **Step 3: Add provider prompt abstraction**

In `native-helper/src/providers/mod.rs`, add:

```rust
#[derive(Clone, Debug)]
pub struct ProviderPromptRequest {
    pub prompt: String,
    pub model: Option<String>,
    pub timeout_ms: u64,
}

#[derive(Clone, Debug)]
pub struct ProviderPromptResult {
    pub text: String,
    pub elapsed_ms: u64,
}
```

Change the `Provider` trait:

```rust
fn run_prompt(&self, request: ProviderPromptRequest) -> Result<ProviderPromptResult, ProviderError>;

fn translate(&self, request: ProviderTranslateRequest) -> Result<ProviderTranslateResult, ProviderError> {
    let prompt = crate::prompt::build_translate_prompt(
        &request.text,
        &request.source_lang,
        &request.target_lang,
    );
    let result = self.run_prompt(ProviderPromptRequest {
        prompt,
        model: request.model,
        timeout_ms: request.timeout_ms,
    })?;
    Ok(ProviderTranslateResult {
        translated_text: result.text,
        elapsed_ms: result.elapsed_ms,
    })
}
```

Add `ProviderRegistry::run_prompt` with the same provider selection switch as `translate`.

- [ ] **Step 4: Move provider implementations to `run_prompt`**

For each provider file, rename the concrete `translate` implementation to `run_prompt`, remove local `build_translate_prompt` usage, and pass `request.prompt` to `ProcessRequest.stdin`.

Example for `claude.rs`:

```rust
fn run_prompt(
    &self,
    request: ProviderPromptRequest,
) -> Result<ProviderPromptResult, ProviderError> {
    let Some(binary) = self.find_binary() else {
        return Err(ProviderError::NotFound { executable: PathBuf::from("claude") });
    };
    let temp_dir = tempdir().map_err(|error| ProviderError::SpawnFailed { message: error.to_string() })?;
    let model = request.model.as_deref().map(str::trim).filter(|value| !value.is_empty()).unwrap_or(self.default_model());
    let output = run_process(ProcessRequest {
        executable: binary.clone(),
        args: build_claude_args(Some(model)),
        cwd: Some(temp_dir.path().to_path_buf()),
        env: provider_env(&self.env, &binary),
        stdin: request.prompt,
        timeout_ms: request.timeout_ms,
    })
    .map_err(map_claude_process_error)?;

    Ok(ProviderPromptResult {
        text: parse_claude_output(&output.stdout)?,
        elapsed_ms: output.elapsed_ms,
    })
}
```

- [ ] **Step 5: Verify provider behavior**

Run: `pnpm helper:test -- provider_command_tests`

Expected: PASS.

Run: `pnpm helper:test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add native-helper/src/providers native-helper/tests/provider_command_tests.rs
git commit -m "feat: support raw provider prompts"
```

---

## Task 10: Native Bridge Subtitle Protocol

**Files:**
- Modify: `native-helper/src/messages.rs`
- Modify: `native-helper/src/bridge.rs`
- Modify: `native-helper/tests/bridge_tests.rs`

- [ ] **Step 1: Write failing bridge tests**

In `native-helper/tests/bridge_tests.rs`, add:

```rust
#[test]
fn subtitle_cache_miss_returns_cached_false() {
    let temp = tempdir().unwrap();
    let cache_path = temp.path().join("cache.sqlite");
    let mut env = BTreeMap::new();
    env.insert("HOVER_TRANS_PORT_CACHE_PATH".to_string(), cache_path.to_string_lossy().into_owned());
    env.insert("HOME".to_string(), temp.path().display().to_string());

    let response = handle_request(
        json!({
            "type": "GET_SUBTITLE_TRANSLATION_CACHE",
            "requestId": "req-sub-cache",
            "provider": "codex",
            "model": "gpt-5.4-mini",
            "targetLang": "Korean",
            "videoId": "abc",
            "sourceTrackIdentity": "track",
            "sourceTimelineHash": "hash",
            "promptVersion": 1
        }),
        BridgeDeps::with_env(env),
    );

    assert_eq!(response["type"], "SUBTITLE_CACHE_RESULT");
    assert_eq!(response["requestId"], "req-sub-cache");
    assert_eq!(response["ok"], true);
    assert_eq!(response["cached"], false);
}
```

Add a translation test using a provider fixture that returns a valid subtitle JSON response.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm helper:test -- subtitle_cache_miss_returns_cached_false`

Expected: FAIL because bridge route is missing.

- [ ] **Step 3: Add native message structs**

In `native-helper/src/messages.rs`, add structs:

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleCacheRequest {
    pub request_id: String,
    pub target_lang: String,
    pub video_id: String,
    pub source_track_identity: String,
    pub source_timeline_hash: String,
    pub prompt_version: u64,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateSubtitlesRequest {
    pub request_id: String,
    pub target_lang: String,
    pub video_id: String,
    pub source_track_identity: String,
    pub source_timeline_hash: String,
    pub prompt_version: u64,
    pub cues: Vec<crate::subtitles::SubtitleCue>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub cache_enabled: Option<bool>,
    #[serde(default)]
    pub debug_logging: Option<bool>,
}
```

- [ ] **Step 4: Route bridge messages**

In `native-helper/src/bridge.rs`, add match arms:

```rust
Some("GET_SUBTITLE_TRANSLATION_CACHE") => subtitle_cache_lookup(value, request_id, deps),
Some("TRANSLATE_SUBTITLES") => translate_subtitles(value, request_id, deps),
```

`subtitle_cache_lookup` opens `SqliteSubtitleTranslationCache`, builds a key from request dimensions, and returns `SUBTITLE_CACHE_RESULT` with `cached: false` or `cached: true, cues`.

`translate_subtitles` validates input, checks subtitle cache first, chunks cues, builds subtitle prompt per chunk, calls `registry.run_prompt`, validates each output chunk, writes one complete cache entry after all chunks pass, and returns `SUBTITLE_TRANSLATE_RESULT`.

- [ ] **Step 5: Update clear cache**

In `cache_clear`, clear both existing text cache and subtitle cache. Return the total deleted row count in `deletedRows`.

- [ ] **Step 6: Verify**

Run: `pnpm helper:test -- bridge_tests`

Expected: PASS.

Run: `pnpm helper:test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add native-helper/src/messages.rs native-helper/src/bridge.rs native-helper/tests/bridge_tests.rs
git commit -m "feat: add native subtitle translation bridge"
```

---

## Task 11: Documentation And Verify Integration

**Files:**
- Modify: `README.md`
- Modify: `readmes/README.ko.md`
- Modify: `PRIVACY.md`
- Modify: `docs/native-host-install.md`
- Modify: `package.json`

- [ ] **Step 1: Update docs**

In `README.md`, move subtitle translation from "Not yet" to "Works today" with wording:

```markdown
| YouTube provided-caption pre-translation and local subtitle cache | PDF, iframe, OCR, or audio transcription |
```

In `PRIVACY.md`, add:

```markdown
YouTube subtitle translation can cache longer source and translated excerpts than hover or selection translation because it stores a video's timed caption track. Subtitle cache entries remain local plaintext SQLite and are cleared by the same cache clear control.
```

Mirror user-facing Korean wording in `readmes/README.ko.md`.

- [ ] **Step 2: Ensure all new checks are in `verify`**

Confirm `package.json` includes:

```json
"youtube-subtitles-shared:check": "node scripts/youtube-subtitles-shared-check.mjs",
"youtube-caption-tracks:check": "node scripts/youtube-caption-tracks-check.mjs",
"youtube-transcript-fetch:check": "node scripts/youtube-transcript-fetch-check.mjs",
"youtube-subtitle-ui:check": "node scripts/youtube-subtitle-ui-check.mjs",
"youtube-subtitle-session:check": "node scripts/youtube-subtitle-session-check.mjs",
"youtube-subtitle-protocol:check": "node scripts/youtube-subtitle-protocol-check.mjs"
```

Confirm `verify` runs all six scripts before `helper:test`.

- [ ] **Step 3: Run focused checks**

Run:

```bash
pnpm youtube-subtitles-shared:check
pnpm youtube-caption-tracks:check
pnpm youtube-transcript-fetch:check
pnpm youtube-subtitle-ui:check
pnpm youtube-subtitle-session:check
pnpm youtube-subtitle-protocol:check
pnpm helper:test
```

Expected: each command exits 0.

- [ ] **Step 4: Commit**

```bash
git add README.md readmes/README.ko.md PRIVACY.md docs/native-host-install.md package.json
git commit -m "docs: document youtube subtitle translation"
```

---

## Task 12: Full Verification And Manual QA

**Files:**
- No planned source changes unless verification finds a defect.

- [ ] **Step 1: Run full verification**

Run: `pnpm verify`

Expected: PASS.

- [ ] **Step 2: Manual QA with local extension build**

Run: `pnpm build`

Expected: PASS and `dist/` updated.

Load `dist/` in Chrome and verify:

- YouTube video with manual captions shows the control in `.ytp-right-controls-left`.
- YouTube video with automatic captions shows the control in `.ytp-right-controls-left`.
- The control appears after the YouTube subtitle button and before settings when both exist.
- `예` pauses playback, shows `번역 중...`, then enables translated overlay.
- `아니오` suppresses automatic prompt for the same video id until navigation or reload.
- Cached result enables overlay without asking again.
- Long transcript uses the indeterminate spinner.
- A chunk failure fails the whole request and writes no partial subtitle cache entry.
- Videos without captions use the unavailable state and do not show a misleading prompt.
- Existing hover-block translation still works on a normal web page.
- Existing selection bubble translation still works on a normal web page.

- [ ] **Step 3: Commit any verification fixes**

If manual QA reveals a defect, fix it in the smallest relevant file, run the focused check plus `pnpm verify`, and commit with a message that names the defect.

If no fixes are needed, do not create a commit for this task.

---

## Self-Review Coverage

- Spec goal and non-goals: covered by Task 5, Task 10, Task 11, and Task 12.
- Control placement and states: covered by Task 4 and Task 12.
- Caption track selection: covered by Task 2 and Task 5.
- Transcript fetch before cache lookup: covered by Task 3, Task 5, and Task 6.
- Cache dimensions and subtitle cache table: covered by Task 1, Task 6, Task 8, and Task 10.
- Provider JSON prompt and validation: covered by Task 8, Task 9, and Task 10.
- Chunking and timeout policy: covered by Task 1, Task 8, Task 10, and Task 12.
- Error handling and stale response behavior: covered by Task 5, Task 7, Task 10, and Task 12.
- Privacy and documentation: covered by Task 11.

No implementation task should start until this plan is reviewed and an execution mode is selected.
