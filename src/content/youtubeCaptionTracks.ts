import type {
  YouTubeCaptionTrack,
  YouTubeCaptionTrackKind
} from "../shared/youtubeSubtitles";
import {
  createSubtitleTrackIdentity,
  normalizeYouTubeTimedTextBaseUrl,
  normalizeSubtitleText
} from "../shared/youtubeSubtitles";

type SelectCaptionTrackInput = {
  tracks: YouTubeCaptionTrack[];
  activeLanguageCode?: string;
  activeKind?: YouTubeCaptionTrackKind;
  targetLang: string;
};

const TARGET_LANG_TO_CODE: Record<string, string> = {
  "한국어": "ko",
  korean: "ko",
  "영어": "en",
  english: "en",
  "日本語": "ja",
  "일본어": "ja",
  japanese: "ja",
  "中文": "zh",
  "중국어": "zh",
  chinese: "zh",
  "español": "es",
  "스페인어": "es",
  spanish: "es"
};
const DISPLAY_NAME_LOCALES = ["en", "ko", "ja", "zh", "es"] as const;
const languageDisplayNamesByLocale = new Map<string, Intl.DisplayNames>();

export function targetLangToLanguageCode(targetLang: string): string {
  return (
    TARGET_LANG_TO_CODE[targetLang.trim().toLowerCase()] ??
    targetLang.trim().toLowerCase()
  );
}

export function isCaptionTrackLanguageTarget(
  track: YouTubeCaptionTrack,
  targetLang: string
): boolean {
  return isCaptionLanguageTarget(track.languageCode, targetLang);
}

export function isCaptionLanguageTarget(
  languageCode: string,
  targetLang: string
): boolean {
  const trackCode = normalizeLanguagePrimaryCode(languageCode);
  const targetCode = normalizeLanguagePrimaryCode(
    targetLangToLanguageCode(targetLang)
  );

  if (trackCode.length > 0 && trackCode === targetCode) {
    return true;
  }

  return isCaptionLanguageDisplayNameTarget(languageCode, targetLang);
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
      const baseUrl = normalizeYouTubeTimedTextBaseUrl(raw.baseUrl ?? "");
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
  const candidates: YouTubeCaptionTrack[] = [];
  const seen = new Set<string>();
  const add = (track: YouTubeCaptionTrack | undefined): void => {
    if (!track) {
      return;
    }

    if (isCaptionTrackLanguageTarget(track, input.targetLang)) {
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

function normalizeLanguagePrimaryCode(language: string): string {
  return language.trim().toLowerCase().replace(/_/gu, "-").split("-")[0] ?? "";
}

function isCaptionLanguageDisplayNameTarget(
  languageCode: string,
  targetLang: string
): boolean {
  const targetName = normalizeLanguageDisplayName(targetLang);

  if (!targetName || typeof Intl.DisplayNames !== "function") {
    return false;
  }

  for (const code of languageCodeCandidates(languageCode)) {
    for (const locale of displayNameLocales()) {
      const displayName = getLanguageDisplayName(locale, code);

      if (
        displayName &&
        normalizeLanguageDisplayName(displayName) === targetName
      ) {
        return true;
      }
    }
  }

  return false;
}

function languageCodeCandidates(languageCode: string): string[] {
  const normalized = languageCode.trim().toLowerCase().replace(/_/gu, "-");
  const primary = normalizeLanguagePrimaryCode(normalized);

  return Array.from(new Set([normalized, primary].filter(Boolean)));
}

function displayNameLocales(): string[] {
  const locales = new Set<string>(DISPLAY_NAME_LOCALES);

  if (typeof navigator !== "undefined") {
    const navigatorLocales = [
      ...(navigator.languages ?? []),
      navigator.language
    ].filter((locale): locale is string => typeof locale === "string");

    for (const locale of navigatorLocales) {
      const primary = normalizeLanguagePrimaryCode(locale);

      if (primary) {
        locales.add(primary);
      }
    }
  }

  return [...locales];
}

function getLanguageDisplayName(locale: string, languageCode: string): string {
  try {
    let displayNames = languageDisplayNamesByLocale.get(locale);

    if (!displayNames) {
      displayNames = new Intl.DisplayNames([locale], { type: "language" });
      languageDisplayNamesByLocale.set(locale, displayNames);
    }

    return displayNames.of(languageCode) ?? "";
  } catch {
    return "";
  }
}

function normalizeLanguageDisplayName(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ");
}
