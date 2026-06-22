import type {
  YouTubeCaptionTrack,
  YouTubeCaptionTrackKind
} from "../shared/youtubeSubtitles";
import {
  createSubtitleTrackIdentity,
  normalizeSubtitleText
} from "../shared/youtubeSubtitles";

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
  return (
    TARGET_LANG_TO_CODE[targetLang.trim().toLowerCase()] ??
    targetLang.trim().toLowerCase()
  );
}

function captionName(track: unknown): string {
  const value = track as {
    name?: { simpleText?: string; runs?: Array<{ text?: string }> };
  };

  return (
    value.name?.simpleText ??
    value.name?.runs?.map((run) => run.text ?? "").join("") ??
    ""
  );
}

export function extractCaptionTracksFromPlayerResponse(
  playerResponse: unknown
): YouTubeCaptionTrack[] {
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

      const kind: YouTubeCaptionTrackKind =
        raw.kind === "asr" ? "asr" : "manual";
      const candidate = {
        id: raw.vssId?.trim() || `${languageCode}:${kind}:${index}`,
        languageCode,
        displayName: normalizeSubtitleText(captionName(track)) || languageCode,
        kind,
        baseUrl
      };

      return {
        ...candidate,
        id: candidate.id || createSubtitleTrackIdentity(candidate)
      };
    })
    .filter((track): track is YouTubeCaptionTrack => track !== null);
}

export function selectCaptionTrack(
  input: SelectCaptionTrackInput
): YouTubeCaptionTrack | null {
  const tracks = input.tracks.filter((track) => track.baseUrl.trim().length > 0);
  const targetCode = targetLangToLanguageCode(input.targetLang);
  const active = tracks.find((track) => {
    return (
      input.activeLanguageCode &&
      track.languageCode.toLowerCase() ===
        input.activeLanguageCode.toLowerCase() &&
      (!input.activeKind || track.kind === input.activeKind)
    );
  });

  if (active) {
    return active;
  }

  return (
    tracks.find((track) => {
      return (
        track.kind === "manual" &&
        track.languageCode.toLowerCase() !== targetCode
      );
    }) ??
    tracks.find((track) => {
      return (
        track.kind === "asr" && track.languageCode.toLowerCase() !== targetCode
      );
    }) ??
    tracks.find((track) => track.kind === "manual") ??
    tracks.find((track) => track.kind === "asr") ??
    null
  );
}
