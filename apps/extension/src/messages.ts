/** Messaging between the extension's parts (extension-internal). */
import type { TrackInfo } from "@tma/shared";

export const PANEL_PORT_NAME = "sidepanel";

export type MuteState = "none" | "extension" | "user";
export type PlaybackState = "playing" | "paused" | "none";

/** What the content script reads from a page. */
export interface MediaState {
  /** From `navigator.mediaSession.metadata`; null when the page publishes none. */
  track: TrackInfo | null;
  /** The page's `mediaSession.playbackState`, or derived from its media elements when unset. */
  playbackState: PlaybackState;
  /** Muted (or volume 0) in the page's player; null when the page has no media element we can see. */
  playerMuted: boolean | null;
  /** When `playbackState` last became "playing" (ms since epoch). */
  playingSince?: number;
}

export interface TabEntry {
  id: number;
  windowId: number;
  title: string;
  /** Hostname of the tab's page, e.g. "music.youtube.com". */
  site: string;
  favIconUrl?: string;
  active: boolean;
  /** Produced sound in the past couple of seconds (true even when muted at the tab level). */
  audible: boolean;
  /** Tab-level mute and who did it. */
  muted: MuteState;
  /** Last state reported by the content script, if any. */
  media?: MediaState;
  /**
   * The page says it's playing but Chrome hears nothing, and no media element
   * could be checked: probably muted in a player we can't see (Web Audio, or an
   * element not attached to the page).
   */
  silentWhilePlaying: boolean;
}

/** Messages sent by the service worker to the side panel. */
export type PanelMessage = { type: "tabs:snapshot"; tabs: TabEntry[] };

/** Messages sent by the content script to the service worker. */
export type ContentMessage = { type: "media:update"; media: MediaState };
