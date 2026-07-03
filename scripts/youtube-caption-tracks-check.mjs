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
  console.error(`youtube-caption-tracks-check: ${message}`);
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
  join(tmpdir(), "hover-trans-port-youtube-caption-tracks-")
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
  join(tempContentDir, "youtubeCaptionTracks.js"),
  transpile("src/content/youtubeCaptionTracks.ts").replace(
    "../shared/youtubeSubtitles",
    "../shared/youtubeSubtitles.js"
  )
);

try {
  const {
    extractCaptionTracksFromPlayerResponse,
    selectCaptionTrack,
    selectCaptionTrackCandidates
  } = await import(
    pathToFileURL(join(tempContentDir, "youtubeCaptionTracks.js")).href
  );

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
            baseUrl:
              "https://www.youtube.com/api/timedtext?v=abc&lang=ko&kind=asr",
            languageCode: "ko",
            name: { runs: [{ text: "Korean auto" }] },
            kind: "asr",
            vssId: "a.ko"
          },
          {
            baseUrl: "https://evil.example/api/timedtext?v=abc&lang=fr",
            languageCode: "fr",
            name: { simpleText: "French" },
            vssId: ".fr"
          },
          {
            baseUrl: "https://www.youtube.com/redirect?q=https://evil.example",
            languageCode: "de",
            name: { simpleText: "German" },
            vssId: ".de"
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
  assert(
    selectedForKorean?.languageCode === "en",
    "manual non-target language track should win"
  );

  const selectedActive = selectCaptionTrack({
    tracks,
    activeLanguageCode: "ko",
    activeKind: "asr",
    targetLang: "English"
  });
  assert(
    selectedActive?.languageCode === "ko",
    "active track should win when fetchable"
  );

  const selectedForKoreanOnly = selectCaptionTrackCandidates({
    tracks: tracks.filter((track) => track.languageCode === "ko"),
    targetLang: "Korean"
  });
  assert(
    selectedForKoreanOnly.length === 0,
    "target-language caption tracks should not be translation candidates"
  );

  const selectedForLocalizedKoreanOnly = selectCaptionTrackCandidates({
    tracks: tracks.filter((track) => track.languageCode === "ko"),
    targetLang: "한국어"
  });
  assert(
    selectedForLocalizedKoreanOnly.length === 0,
    "localized Korean target labels should match Korean caption tracks"
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
