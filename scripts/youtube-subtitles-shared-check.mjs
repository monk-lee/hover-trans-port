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
    subtitles.SUBTITLE_TRANSLATION_PROMPT_VERSION === 4,
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
  assert(
    chunks[0].contextAfter[0].id === "cue-80",
    "first chunk should include following cues as context"
  );
  assert(
    chunks[1].contextBefore.length === 8 &&
      chunks[1].contextBefore[0].id === "cue-72",
    "later chunks should include preceding cues as context"
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
