/**
 * SPIKE (throwaway): server-side mix test. Offscreen document: turns stream IDs into
 * audio and streams each captured tab's PCM to the server, which mixes.
 * No audio controls here: the server decides, and this document carries out its
 * commands (`capture:stop`). Inspect it from chrome://extensions → "Inspect views: offscreen.html".
 */
import { SERVER_URL, errorText, log, type SpikeMessage } from "./messages.js";
import { HEADER_BYTES, SAMPLE_RATE, type CaptureEvent, type ServerMessage } from "./server-protocol.js";

interface Capture {
  label: string;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  tap: AudioWorkletNode;
  seq: number;
  /** Largest gap between two blocks from the worklet in the current 5 s window, and ever. */
  lastBlockAt: number | undefined;
  maxGapMs: number;
  worstGapMs: number;
}

const context = new AudioContext({ sampleRate: SAMPLE_RATE });
const workletReady = context.audioWorklet.addModule(chrome.runtime.getURL("spike/pcm-tap.worklet.js"));
const captures = new Map<number, Capture>();

log(`offscreen: AudioContext at ${context.sampleRate} Hz`);

// ---------------------------------------------------------------- server connection

let socket: WebSocket | undefined;
let retryMs = 500;
let droppedBlocks = 0;

function connect(): void {
  const ws = new WebSocket(SERVER_URL);
  ws.binaryType = "arraybuffer";
  socket = ws;
  ws.addEventListener("open", () => {
    retryMs = 500;
    log(`offscreen: connected to ${SERVER_URL}`);
    sendEvent({ type: "hello", role: "capture" });
    // After a server restart, announce what's still captured.
    for (const [tabId, capture] of captures) sendEvent({ type: "source:added", tabId, label: capture.label });
  });
  ws.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const message = JSON.parse(event.data) as ServerMessage;
    if (message.type === "capture:stop") {
      log(`offscreen: server asked to stop tab ${message.tabId}`);
      stop(message.tabId, "stopped by the server");
    }
  });
  ws.addEventListener("close", () => {
    if (socket !== ws) return;
    log(`offscreen: disconnected from the server, retrying in ${retryMs} ms`);
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 5000);
  });
}

function sendEvent(event: CaptureEvent): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}

function sendBlock(tabId: number, capture: Capture, pcm: Int16Array): void {
  const now = performance.now();
  if (capture.lastBlockAt !== undefined) {
    const gap = now - capture.lastBlockAt;
    capture.maxGapMs = Math.max(capture.maxGapMs, gap);
    capture.worstGapMs = Math.max(capture.worstGapMs, gap);
  }
  capture.lastBlockAt = now;
  const seq = capture.seq++;
  if (socket?.readyState !== WebSocket.OPEN) {
    droppedBlocks++;
    return;
  }
  const frame = new ArrayBuffer(HEADER_BYTES + pcm.byteLength);
  const header = new DataView(frame);
  header.setUint32(0, tabId, true);
  header.setUint32(4, seq, true);
  header.setUint32(8, pcm.length / 2, true);
  // The block is posted once its last sample is processed: its first sample is 10 ms older.
  // Epoch ms, on the same clock as the server's Date.now(), for the round 3 delay breakdown.
  header.setFloat64(12, performance.timeOrigin + now - (pcm.length / 2 / SAMPLE_RATE) * 1000, true);
  new Int16Array(frame, HEADER_BYTES).set(pcm);
  socket.send(frame);
}

connect();

// Health line every 5 s. A growing bufferedAmount means the socket can't keep up.
// Block gaps well above 10 ms mean Chrome itself delivers the audio unevenly (jitter
// starting in the extension, before the network and the server).
setInterval(() => {
  if (captures.size === 0) return;
  const gaps = [...captures]
    .map(([tabId, c]) => `tab ${tabId} block gap max ${c.maxGapMs.toFixed(1)} ms (worst ${c.worstGapMs.toFixed(1)})`)
    .join("; ");
  for (const capture of captures.values()) capture.maxGapMs = 0;
  console.log(
    `[spike] socket ${socket ? ["connecting", "open", "closing", "closed"][socket.readyState] : "none"}, ` +
      `bufferedAmount ${socket?.bufferedAmount ?? 0} B, blocks dropped while disconnected ${droppedBlocks}; ${gaps}`,
  );
}, 5000);

// ---------------------------------------------------------------- captures

async function capture(tabId: number, streamId: string, label: string): Promise<string> {
  try {
    await workletReady;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } } as MediaTrackConstraints,
      video: false,
    });
    stop(tabId, "replaced");

    const source = context.createMediaStreamSource(stream);
    const tap = new AudioWorkletNode(context, "pcm-tap", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    // Connected to destination only so Chrome keeps processing it: the worklet outputs silence.
    source.connect(tap).connect(context.destination);
    await context.resume();

    const entry: Capture = { label, stream, source, tap, seq: 0, lastBlockAt: undefined, maxGapMs: 0, worstGapMs: 0 };
    captures.set(tabId, entry);
    // Announce first: the server ignores audio from sources it doesn't know.
    sendEvent({ type: "source:added", tabId, label });
    tap.port.onmessage = (event: MessageEvent<Int16Array>) => sendBlock(tabId, entry, event.data);

    stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      log(`offscreen: track ended for tab ${tabId} (${label})`);
      stop(tabId, "track ended (tab closed?)");
    });
    return "ok";
  } catch (error) {
    return `getUserMedia failed: ${errorText(error)}`;
  }
}

function stop(tabId: number, reason: string): void {
  const existing = captures.get(tabId);
  if (!existing) return;
  captures.delete(tabId);
  existing.tap.port.onmessage = null;
  existing.source.disconnect();
  existing.tap.disconnect();
  existing.stream.getTracks().forEach((track) => track.stop());
  sendEvent({ type: "source:ended", tabId, reason });
}

chrome.runtime.onMessage.addListener((message: SpikeMessage, _sender, sendResponse) => {
  switch (message.type) {
    case "spike:capture":
      void capture(message.tabId, message.streamId, message.label).then(sendResponse);
      return true;
    case "spike:navigated":
      // Not stopped here: the server decides, and sends capture:stop if it wants to.
      if (captures.has(message.tabId)) {
        sendEvent({ type: "source:navigated-away", tabId: message.tabId, fromSite: message.fromSite, toSite: message.toSite });
      }
      return;
    default:
      return;
  }
});
