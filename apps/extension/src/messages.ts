/** Messaging between the service worker and the side panel (extension-internal). */

export const PANEL_PORT_NAME = "sidepanel";

export type MuteState = "none" | "extension" | "user";

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
}

/** Messages sent by the service worker to the side panel. */
export type PanelMessage = { type: "tabs:snapshot"; tabs: TabEntry[] };
