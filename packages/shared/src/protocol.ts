/**
 * WebSocket protocol between the browser extension (client) and the local server.
 * Draft: will evolve once the extension's audio capture is in place.
 */

export const DEFAULT_SERVER_PORT = 7531;

/** Stable identifier for an audio source (one per captured browser tab). */
export type SourceId = string;

export interface BrowserTabInfo {
  tabId: number;
  playbackState: string;
  track?: TrackInfo;
}

export interface TrackInfo {
  title: string;
  artist: string;
  coverUrl?: string;
}

export interface SourceInfo {
  id: SourceId;
  /** Tab/site label, e.g. "YouTube Music". */
  label: string;
  track?: TrackInfo;
}

/** Messages sent by the extension to the server. */
export type ClientMessage =
  | { type: "source:register"; source: SourceInfo }
  | { type: "source:update"; id: SourceId; track: TrackInfo }
  | { type: "source:unregister"; id: SourceId };

/** Messages sent by the server to connected clients. */
export type ServerMessage =
  | { type: "state"; sources: SourceInfo[]; activeSourceId: SourceId | null }
  | { type: "error"; message: string };
