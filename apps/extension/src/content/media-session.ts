/**
 * Content script (isolated world): reads the page's Media Session info and media
 * elements, and reports changes to the service worker.
 *
 * There is no event for Media Session changes, so the page is checked every second.
 */
import type { TrackInfo } from "@tma/shared";
import type { ContentMessage, MediaState, PlaybackState } from "../messages.js";

const POLL_INTERVAL_MS = 1000;
/** A cleared track is only reported after this long, to ignore gaps between songs. */
const TRACK_CLEARED_GRACE_MS = 10_000;

declare global {
  // Set by the running instance, so a second injection doesn't start another one.
  var __tmaMediaWatcher: { isAlive: () => boolean } | undefined;
}

function isExtensionAlive(): boolean {
  // After the extension reloads, scripts injected by the old version lose access to it.
  return chrome.runtime?.id !== undefined;
}

function artworkArea(sizes: string | undefined): number {
  if (!sizes) return 0;
  if (sizes === "any") return Number.POSITIVE_INFINITY;
  return Math.max(
    0,
    ...sizes.split(/\s+/).map((size) => {
      const [width, height] = size.toLowerCase().split("x").map(Number);
      return (width ?? 0) * (height ?? 0) || 0;
    }),
  );
}

function readTrack(): TrackInfo | null {
  const metadata = navigator.mediaSession?.metadata;
  if (!metadata || (!metadata.title && !metadata.artist)) return null;

  const track: TrackInfo = { title: metadata.title, artist: metadata.artist };
  // Pick the largest artwork; when sizes are missing, the last one is usually the largest.
  let cover: MediaImage | undefined;
  for (const image of metadata.artwork) {
    if (!cover || artworkArea(image.sizes) >= artworkArea(cover.sizes)) cover = image;
  }
  if (cover?.src) track.coverUrl = cover.src;
  return track;
}

function readMediaElements(): { playbackState: PlaybackState; playerMuted: boolean | null } {
  const elements = [...document.querySelectorAll<HTMLMediaElement>("audio, video")].filter(
    (element) => element.currentSrc || element.srcObject,
  );
  const playing = elements.filter((element) => !element.paused && !element.ended);
  // Judge mute on the playing elements when there are some (ignores muted previews).
  const candidates = playing.length > 0 ? playing : elements;
  const playerMuted =
    candidates.length > 0 ? candidates.every((element) => element.muted || element.volume === 0) : null;

  let playbackState: PlaybackState = "none";
  if (playing.length > 0) playbackState = "playing";
  else if (elements.length > 0) playbackState = "paused";
  return { playbackState, playerMuted };
}

function readMediaState(): MediaState {
  const fromElements = readMediaElements();
  const declared = navigator.mediaSession?.playbackState ?? "none";
  return {
    track: readTrack(),
    playbackState: declared !== "none" ? declared : fromElements.playbackState,
    playerMuted: fromElements.playerMuted,
  };
}

function start(): void {
  let lastSent: string | undefined;
  let lastTrack: TrackInfo | null = null;
  let trackClearedAt: number | undefined;

  const timer = setInterval(check, POLL_INTERVAL_MS);
  globalThis.__tmaMediaWatcher = { isAlive: isExtensionAlive };
  check();

  function check(): void {
    if (!isExtensionAlive()) {
      clearInterval(timer);
      return;
    }

    const state = readMediaState();

    // Keep reporting the previous track during a short gap.
    if (state.track) {
      lastTrack = state.track;
      trackClearedAt = undefined;
    } else if (lastTrack) {
      trackClearedAt ??= Date.now();
      if (Date.now() - trackClearedAt < TRACK_CLEARED_GRACE_MS) state.track = lastTrack;
      else lastTrack = null;
    }

    const serialized = JSON.stringify(state);
    if (serialized === lastSent) return;
    lastSent = serialized;

    const message: ContentMessage = { type: "media:update", media: state };
    chrome.runtime.sendMessage(message).catch(() => {
      // The service worker may be restarting: send again on the next check.
      lastSent = undefined;
    });
  }
}

if (!globalThis.__tmaMediaWatcher?.isAlive()) start();
