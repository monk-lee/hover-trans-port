import type {
  YouTubeCaptionTrack,
  YouTubeSubtitleCue
} from "../shared/youtubeSubtitles";
import { normalizeSubtitleCues } from "../shared/youtubeSubtitles";

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
