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
  return selectCaptionTrackCandidates(input)[0] ?? null;
}

export function selectCaptionTrackCandidates(
  input: SelectCaptionTrackInput
): YouTubeCaptionTrack[] {
  const tracks = input.tracks.filter((track) => track.baseUrl.trim().length > 0);
  const targetCode = targetLangToLanguageCode(input.targetLang);
  const candidates: YouTubeCaptionTrack[] = [];
  const seen = new Set<string>();
  const add = (track: YouTubeCaptionTrack | undefined): void => {
    if (!track) {
      return;
    }

    const key = `${track.id}\n${track.languageCode}\n${track.kind}\n${track.baseUrl}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    candidates.push(track);
  };

  add(
    tracks.find((track) => {
      return (
        input.activeLanguageCode &&
        track.languageCode.toLowerCase() ===
          input.activeLanguageCode.toLowerCase() &&
        (!input.activeKind || track.kind === input.activeKind)
      );
    })
  );

  for (const track of tracks) {
    if (
      track.kind === "manual" &&
      track.languageCode.toLowerCase() !== targetCode
    ) {
      add(track);
    }
  }

  for (const track of tracks) {
    if (
      track.kind === "asr" &&
      track.languageCode.toLowerCase() !== targetCode
    ) {
      add(track);
    }
  }

  for (const track of tracks) {
    if (track.kind === "manual") {
      add(track);
    }
  }

  for (const track of tracks) {
    if (track.kind === "asr") {
      add(track);
    }
  }

  return candidates;
}
