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
  "SUBTITLE_TRANSLATION_RESULT"
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

console.log("youtube-subtitle-protocol-check: ok");
