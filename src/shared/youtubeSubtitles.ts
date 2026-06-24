import type { ProviderSelection } from "./providers";

export const SUBTITLE_TRANSLATION_PROMPT_VERSION = 2;
export const SUBTITLE_CHUNK_MAX_CUES = 80;
export const SUBTITLE_CHUNK_MAX_SOURCE_CHARS = 6000;
export const SUBTITLE_CHUNK_CONTEXT_CUES = 8;

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
  contextBefore: YouTubeSubtitleCue[];
  contextAfter: YouTubeSubtitleCue[];
};

export function normalizeSubtitleText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export function normalizeSubtitleCues(
  cues: YouTubeSubtitleCue[]
): YouTubeSubtitleCue[] {
  return cues
    .map((cue) => ({
      id: cue.id.trim(),
      startMs: Math.max(0, Math.round(cue.startMs)),
      endMs: Math.max(0, Math.round(cue.endMs)),
      text: normalizeSubtitleText(cue.text)
    }))
    .filter((cue) => {
      return cue.id.length > 0 && cue.endMs > cue.startMs && cue.text.length > 0;
    })
    .sort((left, right) => {
      return (
        left.startMs - right.startMs ||
        left.endMs - right.endMs ||
        left.id.localeCompare(right.id)
      );
    });
}

function fnv1a(input: string): string {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

export function createSubtitleSourceTimeline(
  cues: YouTubeSubtitleCue[]
): string {
  return normalizeSubtitleCues(cues)
    .map((cue) => `${cue.id}\t${cue.startMs}\t${cue.endMs}\t${cue.text}`)
    .join("\n");
}

export function createSubtitleSourceTimelineHash(
  cues: YouTubeSubtitleCue[]
): string {
  const timeline = createSubtitleSourceTimeline(cues);

  return `${timeline.length}:${fnv1a(timeline)}`;
}

export function createSubtitleTrackIdentity(
  track: YouTubeCaptionTrack
): string {
  const raw = [
    track.languageCode.trim().toLowerCase(),
    track.kind,
    normalizeSubtitleText(track.displayName),
    track.baseUrl.trim()
  ].join("\n");

  return `${raw.length}:${fnv1a(raw)}`;
}

export function planSubtitleChunks(
  cues: YouTubeSubtitleCue[]
): SubtitleChunk[] {
  const normalized = normalizeSubtitleCues(cues);
  const chunks: SubtitleChunk[] = [];
  let currentStart = 0;
  let currentLength = 0;
  let currentChars = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    const cue = normalized[index];
    const cueChars = cue.text.length;
    const wouldExceedCount = currentLength >= SUBTITLE_CHUNK_MAX_CUES;
    const wouldExceedChars =
      currentLength > 0 &&
      currentChars + cueChars > SUBTITLE_CHUNK_MAX_SOURCE_CHARS;

    if (wouldExceedCount || wouldExceedChars) {
      chunks.push(createSubtitleChunk(chunks.length, normalized, currentStart, index));
      currentStart = index;
      currentLength = 0;
      currentChars = 0;
    }

    currentLength += 1;
    currentChars += cueChars;
  }

  if (currentLength > 0) {
    chunks.push(
      createSubtitleChunk(
        chunks.length,
        normalized,
        currentStart,
        normalized.length
      )
    );
  }

  return chunks;
}

function createSubtitleChunk(
  index: number,
  cues: YouTubeSubtitleCue[],
  start: number,
  end: number
): SubtitleChunk {
  const contextBeforeStart = Math.max(0, start - SUBTITLE_CHUNK_CONTEXT_CUES);
  const contextAfterEnd = Math.min(cues.length, end + SUBTITLE_CHUNK_CONTEXT_CUES);

  return {
    index,
    cues: cues.slice(start, end),
    contextBefore: cues.slice(contextBeforeStart, start),
    contextAfter: cues.slice(end, contextAfterEnd)
  };
}
