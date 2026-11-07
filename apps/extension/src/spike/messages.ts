/**
 * SPIKE (throwaway): multi-tab capture test. See test/cases/spike-tab-capture.md.
 * Messages between the service worker, the offscreen document and the side panel.
 */

export const OFFSCREEN_PATH = "spike/offscreen.html";

/** How the capture was triggered, to record which user actions grant activeTab. */
export type CaptureTrigger = "context-menu" | "shortcut" | "panel-button" | "toolbar-icon";

export interface CaptureView {
  tabId: number;
  label: string;
  gain: number;
  trackState: MediaStreamTrackState;
  startedAt: number;
}

export interface SpikeStatus {
  captures: CaptureView[];
  baseLatency: number;
  outputLatency: number;
}

export type SpikeMessage =
  /** Panel → service worker: a stream ID obtained by the panel itself. */
  | { type: "spike:attach"; tabId: number; streamId: string; trigger: CaptureTrigger }
  /** Service worker → offscreen: start playing a captured tab. */
  | { type: "spike:capture"; tabId: number; streamId: string; label: string }
  /** Panel → offscreen. */
  | { type: "spike:status" }
  | { type: "spike:gain"; tabId: number; gain: number }
  | { type: "spike:crossfade"; toTabId: number; seconds: number }
  | { type: "spike:stop"; tabId: number }
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
