# YouTube Subtitle Translation Design

## Context

HoverTransPort currently translates selected text and hovered readable blocks through a Chrome MV3 extension, a background service worker, and a local native helper. The native helper invokes the selected local AI CLI provider and optionally stores successful text translations in the local SQLite cache.

YouTube subtitle translation is not part of the current scope. The existing translation protocol accepts one plain text target at a time, and the existing content rendering path is optimized for inline page text, not timed video subtitles.

The desired feature is intentionally narrower than full video translation: support only YouTube videos that already expose YouTube captions or automatic captions. Do not generate transcripts from audio. Do not share translations with other users.

## Goal

Let users pre-translate a YouTube video's available caption track before watching, then display the translated subtitles in sync with video playback.

The feature must feel native to the YouTube player. HoverTransPort fetches and normalizes the selected YouTube caption track before prompting so it can compute the source timeline hash and check the local cache. It must not invoke a translation provider until the user accepts. When no cached translation exists, HoverTransPort asks from the YouTube control bar whether to translate the subtitles first. If the user accepts, the extension pauses the video, translates the full timed transcript through the existing local provider flow, shows a spinner in the control bar, stores the result locally, and then displays translated subtitle cues during playback.

## Non-Goals

- Do not support videos without YouTube-provided captions or automatic captions.
- Do not perform speech recognition, OCR, or audio extraction.
- Do not add P2P, LAN, cloud, or external translation result sharing.
- Do not add paid hosted infrastructure or account features.
- Do not replace YouTube's own subtitle settings UI.
- Do not depend on live, per-cue real-time translation during playback.
- Do not add this feature to non-YouTube video sites in this iteration.

## User Experience

On YouTube watch pages, the content script looks for the player controls, the video element, and usable caption tracks. HoverTransPort inserts a compact control into `.ytp-right-controls-left` when the YouTube player controls are available. If no usable caption track exists, the control uses the `unavailable` state and does not show the translation prompt automatically.

Preferred placement:

- inside `.ytp-right-controls-left`
- after YouTube's subtitle button when present
- before YouTube's settings button when present
- never duplicated if YouTube re-renders the controls

The control must visually sit with YouTube's existing controls:

- small `ytp-button`-sized affordance
- white icon/text treatment over the player chrome
- no large text directly inside the control bar
- `hover-trans-port-*` class names for project-owned styling

The control states are:

- `prompt`: short entry point such as `번역?`
- `popover`: anchored question such as `자막 번역할까요?` with `예` and `아니오`
- `loading`: spinner and short label such as `번역 중...`
- `enabled`: translated subtitles are available and currently shown
- `disabled`: translated subtitles are available but currently hidden
- `unavailable`: no usable YouTube caption track was found
- `error`: translation failed, with a retry affordance

When the user selects `예`, the content script pauses the video if it is playing, starts the full subtitle translation request, and keeps the player in a loading state until translation completes or fails. When translation succeeds, translated subtitle display is enabled. If the video had been playing before the user accepted, playback resumes after the translated cues are ready.

When the user selects `아니오`, the extension suppresses automatic prompting for the current video id and page session. The compact control remains in the disabled state; clicking it reopens the prompt manually.

If a cached translation exists for the current video, caption track, provider, model, and target language, the feature skips the question and shows the enabled/disabled control immediately. The first playback experience is not blocked by an already-cached result.

## Caption Track Selection

The first iteration translates one caption track per video session. Use this deterministic selection order:

1. The caption track currently active in the YouTube player, if captions are already enabled and the active track can be resolved to a fetchable track.
2. A manual caption track whose language is different from the normalized target language.
3. An automatic caption track whose language is different from the normalized target language.
4. The first manual caption track in YouTube's provided track order.
5. The first automatic caption track in YouTube's provided track order.

If no track in this order has a fetchable transcript URL, the session enters the `unavailable` state. The selected track identity must be stable enough for cache use and must include YouTube's track language, display name when available, track kind such as manual or ASR, and the fetch URL or a normalized hash of it.

## Subtitle Display

Use a project-owned overlay instead of trying to inject a WebVTT track into YouTube's player. The overlay reads the active translated cue from `video.currentTime` and renders it above the bottom controls in a stable, centered position.

The overlay must:

- avoid covering the YouTube control bar
- hide while no translated cue is active
- update on `timeupdate`, `seeking`, `play`, `pause`, and caption result changes
- stay attached through theater mode, fullscreen, and mini player layout changes when the player root is stable
- reattach through the page observer when YouTube replaces the player root or controls
- use `notranslate` and a project-owned class prefix

The first iteration shows only the translated subtitle text. It does not include dual-language display, cue styling customization, or draggable placement.

## Data Model

Use a timed subtitle representation independent of YouTube's raw response format:

```ts
type YouTubeSubtitleCue = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
};

type TranslatedSubtitleCue = {
  id: string;
  startMs: number;
  endMs: number;
  translatedText: string;
};
```

The cache key must include:

- YouTube video id
- source caption track identity, including language and track kind when available
- a hash of the normalized source cue timeline
- target language
- provider
- model
- subtitle translation prompt version

Including a source timeline hash prevents stale translations from being reused when YouTube changes an automatic caption track for the same video.

The source timeline hash is computed after fetching and normalizing the selected transcript. Cache lookup cannot run before this hash exists. Fetching the YouTube transcript for cache lookup is allowed before prompting because it does not invoke the configured translation provider.

## Architecture

Add YouTube-specific content modules instead of folding this behavior into the generic hover/selection path.

Expected content modules:

- `youtubePageObserver.ts`: detects YouTube watch navigation and player DOM replacement.
- `youtubeCaptionTracks.ts`: extracts usable caption track metadata from the page/player state.
- `youtubeTranscriptFetch.ts`: fetches and normalizes the selected YouTube caption track into timed cues.
- `youtubeSubtitleControl.ts`: injects the `.ytp-right-controls-left` control, prompt, buttons, spinner, and state styling.
- `youtubeSubtitleOverlay.ts`: renders translated cues in sync with the active video element.
- `youtubeSubtitleSession.ts`: coordinates per-video state, prompt suppression, cache lookup, translation request, and overlay activation.

Expected background messages:

- `GET_SUBTITLE_TRANSLATION_CACHE`
- `TRANSLATE_SUBTITLE_TRACK`
- `CLEAR_TRANSLATION_CACHE` clears subtitle translations as well as existing text translations.

`GET_SUBTITLE_TRANSLATION_CACHE` must receive the video id, selected source track identity, source timeline hash, target language, provider, model, and subtitle prompt version. `TRANSLATE_SUBTITLE_TRACK` must receive those same cache dimensions plus the normalized source cues.

Expected native helper protocol:

- add `TRANSLATE_SUBTITLES`
- return structured translated cues rather than one concatenated string
- keep existing `TRANSLATE` behavior unchanged

The native helper performs subtitle translation as one batch request when cue count and text size fit within provider limits. When a transcript exceeds those limits, it chunks internally by cue ranges while preserving cue ids and order.

Initial chunking policy:

- Maximum 80 cues per provider request.
- Maximum 6,000 source characters per provider request, counted after cue text normalization and excluding JSON envelope overhead.
- Use the existing normalized user timeout as the per-chunk provider timeout.
- The background native-message timeout for a subtitle request is `(perChunkTimeoutMs + 5000) * chunkCount`.
- The content control uses an indeterminate spinner in the first iteration; it does not need percentage progress.
- If any chunk fails, times out, or returns invalid structured output, the entire subtitle translation request fails and no partial subtitle cache entry is written.

## Translation Prompt Contract

The subtitle translation prompt must preserve timing structure. The provider receives cue ids and source text and must return JSON containing the same cue ids with translated text.

Prompt requirements:

- translate each cue to the selected target language
- preserve cue ids exactly
- do not merge, split, drop, or reorder cues
- return valid JSON only
- do not include markdown fences
- preserve names, numbers, product names, and on-screen terminology

The native helper validates the provider output before returning success. A valid result must contain one translated entry for every requested cue id. If validation fails, the response is `PROVIDER_OUTPUT_PARSE_FAILED` or a subtitle-specific parse error mapped to a user-facing failure.

## Data Flow

1. The user navigates to a YouTube watch page.
2. `youtubePageObserver` identifies the current video id, player root, controls, and video element.
3. `youtubeCaptionTracks` finds YouTube-provided captions or automatic captions.
4. `youtubeSubtitleSession` selects one caption track using the deterministic track selection order.
5. If no fetchable track exists, `youtubeSubtitleControl` shows the `unavailable` state and does not prompt.
6. `youtubeTranscriptFetch` fetches and normalizes the selected transcript, then computes the source timeline hash.
7. `youtubeSubtitleSession` asks the background for a matching local subtitle translation cache entry using the full cache key dimensions.
8. If a cache hit exists, `youtubeSubtitleOverlay` activates translated subtitles and `youtubeSubtitleControl` shows the enabled state.
9. If no cache hit exists, `youtubeSubtitleControl` inserts or updates the compact prompt in `.ytp-right-controls-left`.
10. If the user chooses `아니오`, the prompt is suppressed for that video id in the page session.
11. If the user chooses `예`, the session pauses the video and sends `TRANSLATE_SUBTITLE_TRACK` with the normalized cues and cache key dimensions.
12. The background checks native host compatibility and sends `TRANSLATE_SUBTITLES` to the native helper.
13. The native helper checks subtitle cache again to deduplicate races, runs the selected provider if needed, validates structured output, writes one complete cache entry, and returns translated cues.
14. The content script activates the overlay and updates it as playback time changes.

## Error Handling

If no usable caption track exists, keep the compact control in the `unavailable` state and do not show the translation prompt automatically. If the user opens the unavailable control manually, show the short message: `사용 가능한 YouTube 자막이 없습니다.`

If fetching the transcript fails, show an error state in the control with retry. Do not start provider translation and do not ask the background for a cache entry because the source timeline hash is unavailable.

If the provider times out, a subtitle chunk fails, or output validation fails, show the existing provider-aware error message style and allow retry. Do not write partial translated cues to cache.

If YouTube re-renders controls or navigates to another video while translation is in flight, the response must be ignored unless it still matches the active video id and source track hash.

If cache read or write fails, translation continues for the current page session. The control must not claim the result was cached.

## Privacy And Storage

Subtitle translation uses the same privacy model as existing text translation: requested source text is sent to the selected local CLI provider, and that provider may send it upstream according to the user's provider setup.

Successful subtitle translations are local-only. They are not shared with other users and are not sent to any HoverTransPort server.

The local cache stores normalized source subtitle text and translated subtitle text in plaintext SQLite, consistent with the existing cache warning. Documentation must mention that subtitle caches may contain longer excerpts than hover or selection translations.

## Testing

Add focused tests for pure parsing and cache logic:

- caption track extraction from representative YouTube player data
- deterministic track selection for active, manual, automatic, target-language, and missing-track cases
- transcript normalization into ordered cues
- subtitle cache key changes when cue text, timing, provider, model, target language, or prompt version changes
- cache lookup happens only after transcript normalization and source timeline hash calculation
- subtitle chunk planning respects cue-count and source-character limits
- native helper validation rejects missing, duplicate, reordered, or malformed cue translations
- control injection is idempotent when `.ytp-right-controls-left` is re-rendered
- session ignores stale translation responses after video id changes

Manual verification before claiming implementation complete:

- YouTube video with manual captions prompts from the right controls area
- YouTube video with automatic captions prompts from the right controls area
- `예` pauses playback, shows spinner, translates, then enables overlay
- `아니오` suppresses the prompt for the current video id and page session
- cached result loads without asking again
- long transcripts show an indeterminate spinner and fail as one request if any chunk fails
- translated subtitle overlay follows playback, seeking, pause, resume, fullscreen, and theater mode
- videos without captions do not show a misleading prompt
- existing hover-block and selection translation behavior still works on normal web pages
- `pnpm verify` passes
