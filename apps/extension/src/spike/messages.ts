/**
 * SPIKE (throwaway): server-side mix test (started from the tab capture spike).
 * See test/cases/spike-server-mix.md.
 * Messages inside the extension: service worker → offscreen document, and logs to the panel.
 * Everything about mixing goes through the server instead (server-protocol.ts).
 */

export const OFFSCREEN_PATH = "spike/offscreen.html";
export const SERVER_URL = "ws://127.0.0.1:7531";

/** How the capture was triggered, to record which user actions grant activeTab. */
export type CaptureTrigger = "context-menu" | "shortcut" | "toolbar-icon";

export type SpikeMessage =
  /** Service worker → offscreen: start capturing a tab and streaming it to the server. */
  | { type: "spike:capture"; tabId: number; streamId: string; label: string }
  /** Service worker → offscreen: a captured tab moved to another site; the server decides. */
  | { type: "spike:navigated"; tabId: number; fromSite: string; toSite: string }
  /** Any → panel: a line for the panel's log. */
  | { type: "spike:log"; text: string };

/** Sends to whoever listens; ignores "no receiver" (e.g. the panel is closed). */
export function send<T = unknown>(message: SpikeMessage): Promise<T | undefined> {
  return chrome.runtime.sendMessage<SpikeMessage, T>(message).catch(() => undefined);
}

export function log(text: string): void {
  console.log(`[spike] ${text}`);
  void send({ type: "spike:log", text: `${new Date().toLocaleTimeString()} ${text}` });
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
