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

console.log("youtube-subtitle-protocol-check: ok");
