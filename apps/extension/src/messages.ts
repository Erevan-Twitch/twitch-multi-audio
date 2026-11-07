/** Messaging between the service worker and the side panel (extension-internal). */

export const PANEL_PORT_NAME = "sidepanel";

export interface TabEntry {
  id: number;
  windowId: number;
  title: string;
  url?: string;
  favIconUrl?: string;
  active: boolean;
  audible: boolean;
  muted: boolean;
}

/** Messages sent by the service worker to the side panel. */
export type PanelMessage = { type: "tabs:snapshot"; tabs: TabEntry[] };
