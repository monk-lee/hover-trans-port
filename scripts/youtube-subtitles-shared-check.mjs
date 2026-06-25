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

const tempDir = mkdtempSync(
  join(tmpdir(), "hover-trans-port-youtube-subtitles-")
);
const tempSharedDir = join(tempDir, "src/shared");
mkdirSync(tempSharedDir, { recursive: true });
writeFileSync(
  join(tempSharedDir, "youtubeSubtitles.js"),
  transpile("src/shared/youtubeSubtitles.ts")
);

try {
  const subtitles = await import(
    pathToFileURL(join(tempSharedDir, "youtubeSubtitles.js")).href
  );
  assert(
    subtitles.SUBTITLE_TRANSLATION_PROMPT_VERSION === 1,
    "subtitle prompt version should invalidate older cache entries after prompt changes"
  );
  const cues = subtitles.normalizeSubtitleCues([
    { id: "b", startMs: 2000, endMs: 3000, text: "  second\nline " },
    { id: "a", startMs: 0, endMs: 1200, text: "Hello   world" },
    { id: "empty", startMs: 3500, endMs: 3600, text: "   " }
  ]);

  assert(cues.length === 2, "blank cues should be removed");
  assert(cues[0].id === "a", "cues should sort by start time");
  assert(cues[0].text === "Hello world", "cue text should normalize whitespace");
  assert(
    cues[1].text === "second line",
    "multiline cue text should normalize whitespace"
  );

  const hashA = subtitles.createSubtitleSourceTimelineHash(cues);
  const hashB = subtitles.createSubtitleSourceTimelineHash([
    { id: "a", startMs: 0, endMs: 1200, text: "Hello world!" },
    { id: "b", startMs: 2000, endMs: 3000, text: "second line" }
  ]);
  assert(
    hashA !== hashB,
    "timeline hash should change when source text changes"
  );

  const denseChunks = subtitles.planSubtitleChunks(
    Array.from({ length: 81 }, (_, index) => ({
      id: `cue-${index}`,
      startMs: index * 700,
      endMs: index * 700 + 500,
      text: "short cue"
    }))
  );
  assert(
    denseChunks.length === 1,
    "81 cues inside one minute should stay in one fixed timeline segment"
  );
  assert(denseChunks[0].cues.length === 81, "dense segment should keep all cues");

  const chunks = subtitles.planSubtitleChunks([
    { id: "cue-0", startMs: 0, endMs: 800, text: "first segment" },
    { id: "cue-1", startMs: 59000, endMs: 59800, text: "still first" },
    { id: "cue-2", startMs: 60000, endMs: 60800, text: "second segment" },
    { id: "cue-3", startMs: 119000, endMs: 119800, text: "still second" },
    { id: "cue-4", startMs: 120000, endMs: 120800, text: "third segment" }
  ]);
  assert(chunks.length === 3, "cues should split on fixed one-minute boundaries");
  assert(chunks[0].cues.length === 2, "first segment should hold cues before 1:00");
  assert(chunks[1].cues.length === 2, "second segment should hold cues from 1:00");
  assert(chunks[2].cues.length === 1, "third segment should hold cues from 2:00");
  assert(
    chunks[0].contextAfter[0].id === "cue-2",
    "first chunk should include following cues as context"
  );
  assert(
    chunks[1].contextBefore[0].id === "cue-0" &&
      chunks[1].contextAfter[0].id === "cue-4",
    "later chunks should include preceding cues as context"
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
