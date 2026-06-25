import { readFileSync } from "node:fs";

function fail(message) {
  console.error(`youtube-subtitle-protocol-check: ${message}`);
  process.exit(1);
}

function assertIncludes(content, expected, label) {
  if (!content.includes(expected)) {
    fail(`${label}: missing ${JSON.stringify(expected)}`);
  }
}

function assertNotIncludes(content, unexpected, label) {
  if (content.includes(unexpected)) {
    fail(`${label}: unexpected ${JSON.stringify(unexpected)}`);
  }
}

const messagesTs = readFileSync("src/shared/messages.ts", "utf8");
const nativeProtocolTs = readFileSync("src/shared/nativeProtocol.ts", "utf8");
const nativeHostCompatibilityTs = readFileSync(
  "src/shared/nativeHostCompatibility.ts",
  "utf8"
);
const nativeHelperMessagesRs = readFileSync("native-helper/src/messages.rs", "utf8");
const serviceWorkerTs = readFileSync("src/background/service-worker.ts", "utf8");
const nativeClientTs = readFileSync("src/background/nativeClient.ts", "utf8");

for (const expected of [
  "GET_SUBTITLE_TRANSLATION_CACHE",
  "TRANSLATE_SUBTITLE_TRACK",
  "SUBTITLE_TRANSLATION_CACHE_RESULT",
  "SUBTITLE_TRANSLATION_RESULT",
  "SUBTITLE_TRANSLATION_PROGRESS",
  "SUBTITLE_TRANSLATION_CHUNK_RESULT"
]) {
  assertIncludes(messagesTs, expected, "extension subtitle protocol");
}

for (const expected of [
  "TRANSLATE_SUBTITLES",
  "SUBTITLE_CACHE_RESULT",
  "SUBTITLE_TRANSLATE_RESULT"
]) {
  assertIncludes(nativeProtocolTs, expected, "native subtitle protocol");
}

assertIncludes(
  serviceWorkerTs,
  "GET_SUBTITLE_TRANSLATION_CACHE",
  "service worker should route subtitle cache requests"
);
assertIncludes(
  serviceWorkerTs,
  "TRANSLATE_SUBTITLE_TRACK",
  "service worker should route subtitle translation requests"
);
assertIncludes(
  nativeClientTs,
  "getSubtitleTranslationCache",
  "native client should expose subtitle cache lookup"
);
assertIncludes(
  nativeClientTs,
  "translateSubtitleTrack",
  "native client should expose subtitle translation"
);
assertIncludes(
  nativeClientTs,
  "planSubtitleTranslationSegments",
  "native client should orchestrate subtitle translation by planned segments"
);
assertIncludes(
  nativeClientTs,
  "onProgress?.({",
  "native client should report subtitle segment progress"
);
assertIncludes(
  nativeClientTs,
  "onChunkResult?.({",
  "native client should stream completed subtitle segment results"
);
assertIncludes(
  nativeClientTs,
  "const chunkRequestId = `${requestId}:chunk-${currentChunk}-of-${totalChunks}`",
  "native client should send one native subtitle request per segment"
);
assertIncludes(
  nativeClientTs,
  "sourceTimelineHash: `${input.sourceTimelineHash}:segment:${chunk.index}:${segmentTimelineHash}`",
  "native client should keep segment subtitle cache keys distinct"
);
assertIncludes(
  nativeClientTs,
  "shouldAbortSubtitleTranslationAfterChunkFailure",
  "native client should distinguish aborting chunk failures from recoverable ones"
);
assertIncludes(
  nativeClientTs,
  'case "PROVIDER_TIMEOUT":',
  "provider timeout should abort sequential subtitle translation"
);
assertIncludes(
  nativeClientTs,
  "SUBTITLE_CHUNK_MAX_ATTEMPTS = 1",
  "provider timeout should abort the failed subtitle segment without retrying it"
);
assertNotIncludes(
  nativeClientTs,
  "subtitle_translation.chunk_retry_start",
  "provider timeout should not start another subtitle segment retry after the segment budget expires"
);
assertIncludes(
  nativeClientTs,
  "getSubtitleNativeResponseTimeoutMs(timeoutMsValue)",
  "subtitle native response wait should include room for repair calls beyond the per-provider timeout"
);
assertIncludes(
  nativeClientTs,
  "SUBTITLE_NATIVE_RESPONSE_TIMEOUT_MULTIPLIER = 2",
  "subtitle native response wait should be longer than a single provider call timeout"
);
assertIncludes(
  nativeClientTs,
  "Native helper response timed out before subtitle translation finished.",
  "subtitle native response timeout should not look like the native host died"
);
assertIncludes(
  nativeClientTs,
  "createSubtitleChunkFailureMessage",
  "subtitle chunk failures should include a user-facing segment number"
);
assertIncludes(
  nativeClientTs,
  "createSubtitlePartialFailureMessage",
  "partial subtitle translation success should summarize failed chunk reasons"
);
assertIncludes(
  nativeClientTs,
  "첫 실패 사유",
  "partial subtitle translation message should expose the first failed chunk reason"
);
assertIncludes(
  serviceWorkerTs,
  "SUBTITLE_TRANSLATION_PROGRESS",
  "service worker should forward subtitle translation progress to the tab"
);
assertIncludes(
  serviceWorkerTs,
  "SUBTITLE_TRANSLATION_CHUNK_RESULT",
  "service worker should forward completed subtitle segment results to the tab"
);
assertIncludes(
  messagesTs,
  '"NATIVE_HOST_UPDATE_REQUIRED"',
  "subtitle protocol should be able to report native host update-required errors"
);
assertIncludes(
  nativeClientTs,
  'nativeHostStatus.error === "NATIVE_HOST_UPDATE_REQUIRED"',
  "subtitle cache lookup should preserve native host update-required errors"
);
assertIncludes(
  nativeHostCompatibilityTs,
  "REQUIRED_NATIVE_HOST_PROTOCOL_VERSION = 2",
  "subtitle-capable extension should require native host protocol 2"
);
assertIncludes(
  nativeProtocolTs,
  "NATIVE_HOST_PROTOCOL_VERSION = 2",
  "subtitle-capable native protocol should advertise protocol 2"
);
assertIncludes(
  nativeHelperMessagesRs,
  "NATIVE_HOST_PROTOCOL_VERSION: u64 = 2",
  "subtitle-capable native helper should report protocol 2"
);
assertNotIncludes(
  nativeClientTs,
  "(timeoutMsValue + NATIVE_TRANSLATION_OVERHEAD_MS) * chunkCountEstimate",
  "subtitle translation should use the configured timeout as a whole-job UI timeout"
);

console.log("youtube-subtitle-protocol-check: ok");
