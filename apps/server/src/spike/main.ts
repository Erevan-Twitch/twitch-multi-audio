/**
 * SPIKE (throwaway): server-side mix test. Run with `pnpm --filter @tma/server spike`.
 * Test steps: apps/extension/test/cases/spike-server-mix.md.
 *
 * The server is the control center: it owns the sources, gains and crossfades.
 * - "capture" client (the extension's offscreen document): sends PCM and source
 *   events, and carries out `capture:stop`.
 * - "control" clients (the side panel, later Stream Deck or web UI): send requests,
 *   receive the state.
 * - stdin console: the same requests, typed in the terminal.
 *
 * Environment: PORT (7531), TMA_OUTPUT_DEVICE ("BlackHole 2ch"),
 * TMA_MONITOR_DEVICE (unset: no monitor), TMA_OUTPUT_BACKEND ("audify" | "ffmpeg"),
 * TMA_JITTER_MS (jitter buffer target, 40), TMA_OUTPUT_QUEUE_BLOCKS (10 ms blocks ahead of the device, 2),
 * TMA_PROBE=1 (round 3: also record the output device's input, for the loopback stage of the delay breakdown).
 */
import { createInterface } from "node:readline";
import { WebSocketServer, type WebSocket } from "ws";
import { DEFAULT_SERVER_PORT } from "@tma/shared";
import { JitterBuffer } from "./jitter-buffer.js";
import { Mixer, TARGET_MS } from "./mixer.js";
import { listDevices, openLoopbackInput, openOutput, type AudioOutput, type Backend, type OutputTiming } from "./output.js";
import { LatencyProbe, OnsetDetector } from "./probe.js";
import {
  CHANNELS,
  HEADER_BYTES,
  SAMPLE_RATE,
  type ClientMessage,
  type ClientRole,
  type ServerMessage,
  type ServerState,
  type TimingView,
} from "./protocol.js";

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const outputDevice = process.env.TMA_OUTPUT_DEVICE ?? "BlackHole 2ch";
const monitorDevice = process.env.TMA_MONITOR_DEVICE;
const backend = process.env.TMA_OUTPUT_BACKEND as Backend | undefined;

const mixer = new Mixer();

// Round 3 delay breakdown (see probe.ts). Detection is cheap, so it always runs;
// it only reports when the click page is open.
const probe = new LatencyProbe((line) => log(line));
const captureOnsets = new Map<number, OnsetDetector>();
const renderOnsets = new OnsetDetector();
const loopOnsets = new OnsetDetector();
const roles = new Map<WebSocket, ClientRole>();

// ---------------------------------------------------------------- output

const { backend: listedBackend, devices } = listDevices(backend);
console.log(`[output] ${listedBackend} devices: ${devices.map((d) => `[${d.id}] ${d.name}`).join(", ") || "none"}`);

const output: AudioOutput = openOutput(outputDevice, backend);
let monitor: AudioOutput | undefined;
/** The monitor gets a copy of the mix through its own queue (it runs on its own clock). */
const monitorQueue = new JitterBuffer(SAMPLE_RATE / 2, SAMPLE_RATE / 25);

if (monitorDevice) {
  monitor = openOutput(monitorDevice, backend);
  if (monitor.info.ok) monitor.start((frames) => monitorQueue.read(frames));
}

if (output.info.ok) {
  output.start((frames) => {
    const pcm = mixer.render(frames);
    const rendered = renderOnsets.feed(pcm, Date.now());
    if (rendered !== undefined) probe.stage("render", rendered);
    if (monitor?.info.ok) monitorQueue.push(pcm);
    return pcm;
  });
  console.log(`[output] playing to "${output.info.device}" with ${output.info.backend}`);
} else {
  console.error(`[output] ✗ ${output.info.error}. The server still runs and shows stats, but nothing is heard.`);
}

if (process.env.TMA_PROBE === "1" && output.info.ok) {
  const result = openLoopbackInput(outputDevice, (pcm, firstSampleAt) => {
    const looped = loopOnsets.feed(pcm, firstSampleAt);
    if (looped !== undefined) probe.stage("loop", looped);
  });
  console.log(`[probe] loopback: ${result}`);
}

// ---------------------------------------------------------------- state

/** Output timing over the last 5 s window (see the drift check below). */
let lastTiming: OutputTiming = output.timing();

function timing(): TimingView {
  const { queuedMs, deviceLatencyMs, maxRenderGapMs, worstRenderGapMs } = lastTiming;
  return {
    jitterTargetMs: TARGET_MS,
    outputQueuedMs: queuedMs,
    deviceLatencyMs,
    maxRenderGapMs,
    worstRenderGapMs,
    serverLatencyMs: TARGET_MS + queuedMs + (deviceLatencyMs ?? 0),
  };
}

function state(): ServerState {
  return {
    sources: mixer.views(),
    activeTabId: mixer.activeTabId,
    captureConnected: [...roles.values()].includes("capture"),
    output: output.info,
    monitor: monitor ? monitor.info : null,
    timing: timing(),
  };
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(message: ServerMessage): void {
  for (const socket of roles.keys()) send(socket, message);
}

function broadcastState(): void {
  broadcast({ type: "state", state: state() });
}

function log(text: string): void {
  console.log(`[server] ${text}`);
  broadcast({ type: "log", text: `server: ${text}` });
}

// ---------------------------------------------------------------- decisions

/** Every request, from any controller, ends up here: the server decides. */
function setGain(tabId: number, gain: number, from: string): void {
  if (mixer.setGain(tabId, gain)) log(`gain of tab ${tabId} → ${gain.toFixed(2)} (from ${from})`);
  else log(`✗ set-gain: unknown tab ${tabId}`);
  broadcastState();
}

function crossfade(tabId: number, seconds: number, from: string): void {
  if (mixer.crossfade(tabId, seconds)) log(`crossfade to tab ${tabId} over ${seconds}s (from ${from})`);
  else log(`✗ crossfade: unknown tab ${tabId}`);
  broadcastState();
}

/** Asks the extension to end the capture; the source is removed when it reports `source:ended`. */
function stopSource(tabId: number, why: string): void {
  const captureClients = [...roles].filter(([, role]) => role === "capture").map(([socket]) => socket);
  if (captureClients.length === 0) {
    mixer.remove(tabId);
    log(`stop tab ${tabId} (${why}): no extension connected, removed locally`);
  } else {
    for (const socket of captureClients) send(socket, { type: "capture:stop", tabId });
    log(`stop tab ${tabId} (${why}): capture:stop sent to the extension`);
  }
  broadcastState();
}

function handle(socket: WebSocket, message: ClientMessage): void {
  switch (message.type) {
    case "hello":
      roles.set(socket, message.role);
      log(`${message.role} client connected`);
      send(socket, { type: "state", state: state() });
      broadcastState();
      return;
    case "source:added":
      mixer.add(message.tabId, message.label);
      log(`source added: tab ${message.tabId} "${message.label}"`);
      broadcastState();
      return;
    case "source:ended":
      mixer.remove(message.tabId);
      log(`source ended: tab ${message.tabId} (${message.reason})`);
      broadcastState();
      return;
    case "source:navigated-away":
      // Version 2 rule: a capture stops when its tab moves to another site. The server decides it.
      log(`tab ${message.tabId} moved from ${message.fromSite} to ${message.toSite}`);
      stopSource(message.tabId, "moved to another site");
      return;
    case "probe:click":
      probe.click(message.id, message.at);
      return;
    case "set-gain":
      setGain(message.tabId, message.gain, "panel");
      return;
    case "crossfade":
      crossfade(message.tabId, message.seconds, "panel");
      return;
    case "stop-source":
      stopSource(message.tabId, "requested by panel");
      return;
  }
}

// ---------------------------------------------------------------- WebSocket

const wss = new WebSocketServer({ host: "127.0.0.1", port });
wss.on("listening", () => console.log(`[server] spike listening on ws://127.0.0.1:${port}`));

wss.on("connection", (socket) => {
  socket.on("message", (raw, isBinary) => {
    if (isBinary) {
      const data = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as ArrayBuffer);
      if (data.byteLength < HEADER_BYTES) return;
      const tabId = data.readUInt32LE(0);
      const seq = data.readUInt32LE(4);
      const frames = data.readUInt32LE(8);
      const capturedAt = data.readDoubleLE(12);
      const arrivedAt = Date.now();
      const bytes = frames * CHANNELS * 2;
      if (data.byteLength < HEADER_BYTES + bytes) return;
      // Copy into an aligned buffer: Int16Array needs an even byte offset.
      const samples = new Int16Array(frames * CHANNELS);
      Buffer.from(samples.buffer).set(data.subarray(HEADER_BYTES, HEADER_BYTES + bytes));
      let detector = captureOnsets.get(tabId);
      if (!detector) captureOnsets.set(tabId, (detector = new OnsetDetector()));
      const captured = detector.feed(samples, capturedAt);
      if (captured !== undefined) {
        probe.stage("capture", captured);
        probe.stage("arrive", arrivedAt);
      }
      mixer.push(tabId, seq, samples);
      return;
    }
    try {
      handle(socket, JSON.parse(raw.toString()) as ClientMessage);
    } catch (error) {
      console.error("[server] bad message", error);
    }
  });
  socket.on("close", () => {
    const role = roles.get(socket);
    roles.delete(socket);
    if (role === "capture") {
      // Its tabs can't send audio anymore; they come back with `source:added` on reconnect.
      for (const tabId of mixer.ids()) mixer.remove(tabId);
      log("capture client disconnected: sources removed");
    } else if (role) {
      log(`${role} client disconnected`);
    }
    broadcastState();
  });
});

setInterval(broadcastState, 1000);

// Drift and jitter check, every 5 s. A buffer that keeps growing or shrinking means the
// clocks disagree. Arrival or render gaps well above 10 ms are jitter: when one is bigger
// than the jitter buffer target, it causes an underrun (a glitch).
setInterval(() => {
  lastTiming = output.timing();
  mixer.rollWindow();
  const t = timing();
  console.log(
    `[timing] render gap max ${t.maxRenderGapMs.toFixed(1)} ms (worst ${t.worstRenderGapMs.toFixed(1)}), ` +
      `server latency ≈ ${t.serverLatencyMs.toFixed(0)} ms (jitter ${t.jitterTargetMs} + queue ${t.outputQueuedMs} + device ${t.deviceLatencyMs?.toFixed(1) ?? "?"})`,
  );
  for (const s of mixer.views()) {
    console.log(
      `[drift] tab ${s.tabId}: buffer ${s.bufferMs.toFixed(1)} ms, underruns ${s.underruns}, ` +
        `overflow ${s.overflowFrames} frames, seq gaps ${s.seqGaps}, ` +
        `arrival gap max ${s.maxArrivalGapMs.toFixed(1)} ms (worst ${s.worstArrivalGapMs.toFixed(1)})`,
    );
  }
}, 5000);

// ---------------------------------------------------------------- console

console.log(`[config] jitter target ${TARGET_MS} ms, output queue ${output.timing().queuedMs} ms`);
console.log("[console] commands: list | gain <tabId> <0-1> | fade <tabId> <seconds> | stop <tabId> | devices");
createInterface({ input: process.stdin }).on("line", (line) => {
  const [command, a, b] = line.trim().split(/\s+/);
  const tabId = Number(a);
  switch (command) {
    case "list":
      console.table(mixer.views().map((s) => ({ ...s, active: s.tabId === mixer.activeTabId })));
      return;
    case "gain":
      setGain(tabId, Number(b), "console");
      return;
    case "fade":
      crossfade(tabId, Number(b ?? 2), "console");
      return;
    case "stop":
      stopSource(tabId, "console");
      return;
    case "devices":
      console.log(listDevices(backend));
      return;
    case "":
    case undefined:
      return;
    default:
      console.log(`unknown command "${command}"`);
  }
});

function shutdown(): void {
  output.stop();
  monitor?.stop();
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
