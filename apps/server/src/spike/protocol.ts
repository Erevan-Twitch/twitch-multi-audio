/**
 * SPIKE (throwaway): server-side mix test. See apps/extension/test/cases/spike-server-mix.md.
 * Wire protocol between the extension and the server for this spike only.
 * Duplicated in apps/extension/src/spike/server-protocol.ts: keep both in sync.
 */

export const SAMPLE_RATE = 48_000;
export const CHANNELS = 2;
/** 10 ms of audio. */
export const BLOCK_FRAMES = 480;

/**
 * Binary frame: a 20-byte little-endian header, then Int16 LE interleaved stereo PCM.
 * Header: u32 source ID (the tab ID), u32 sequence number, u32 frame count,
 * f64 capture time of the first sample (ms since the Unix epoch, same clock as Date.now()).
 */
export const HEADER_BYTES = 20;

export type ClientRole = "capture" | "control" | "probe";

/** Extension (offscreen document) → server. */
export type CaptureEvent =
  | { type: "hello"; role: "capture" }
  | { type: "source:added"; tabId: number; label: string }
  | { type: "source:ended"; tabId: number; reason: string }
  | { type: "source:navigated-away"; tabId: number; fromSite: string; toSite: string };

/** Controllers (side panel, later Stream Deck, web UI) → server. Requests: the server decides. */
export type ControlRequest =
  | { type: "hello"; role: "control" }
  | { type: "set-gain"; tabId: number; gain: number }
  | { type: "crossfade"; tabId: number; seconds: number }
  | { type: "stop-source"; tabId: number };

/** Round 3 click page (test/fixtures/click-page.html) → server: when each click was played. */
export type ProbeMessage =
  | { type: "hello"; role: "probe" }
  | { type: "probe:click"; id: number; at: number };

export type ClientMessage = CaptureEvent | ControlRequest | ProbeMessage;

export interface SourceView {
  tabId: number;
  label: string;
  /** Current gain, and where a ramp is heading. */
  gain: number;
  targetGain: number;
  /** Jitter buffer fill, in milliseconds. */
  bufferMs: number;
  primed: boolean;
  underruns: number;
  overflowFrames: number;
  /** Sequence numbers skipped (frames lost before reaching the server). */
  seqGaps: number;
  framesReceived: number;
  /** Largest gap between two arriving blocks over the last 5 s window, and ever. Ideal: 10 ms. */
  maxArrivalGapMs: number;
  worstArrivalGapMs: number;
}

export interface TimingView {
  jitterTargetMs: number;
  /** Audio written ahead of the device on the server side. */
  outputQueuedMs: number;
  /** Latency reported by the device driver (audify only). */
  deviceLatencyMs: number | null;
  /** Largest gap between two output render calls over the last 5 s window, and ever. Ideal: 10 ms. */
  maxRenderGapMs: number;
  worstRenderGapMs: number;
  /** Server-side delay estimate: jitter buffer + output queue + device latency. */
  serverLatencyMs: number;
}

export interface ServerState {
  sources: SourceView[];
  activeTabId: number | null;
  captureConnected: boolean;
  output: { backend: string; device: string; ok: boolean; error?: string };
  monitor: { backend: string; device: string; ok: boolean; error?: string } | null;
  timing: TimingView;
}

/** Server → clients. `capture:stop` is a command for the capture client. */
export type ServerMessage =
  | { type: "state"; state: ServerState }
  | { type: "capture:stop"; tabId: number }
  | { type: "log"; text: string };
