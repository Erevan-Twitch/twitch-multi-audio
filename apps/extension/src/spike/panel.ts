/**
 * SPIKE (throwaway): server-side mix test. Side panel section: a remote control for
 * the server. It holds no state of its own: it renders the server's `state`
 * broadcasts and sends requests (gain, crossfade, stop) that the server decides on.
 */
import { SERVER_URL, type SpikeMessage } from "./messages.js";
import type { ControlRequest, ServerMessage, ServerState } from "./server-protocol.js";

const root = document.createElement("section");
root.className = "spike";
root.innerHTML = `
  <h2>Spike: server mix</h2>
  <p class="hint">Add a tab with the toolbar button, right-click the page → "Spike: send this tab's audio to the server", or the shortcut. Run the server with <code>pnpm --filter @tma/server spike</code>.</p>
  <p id="spike-connection" class="hint"></p>
  <p id="spike-output" class="hint"></p>
  <label class="fade">Crossfade duration <input id="spike-fade" type="number" min="0" max="10" step="0.5" value="2" /> s</label>
  <ul id="spike-captures"></ul>
  <h3>Log</h3>
  <ol id="spike-log"></ol>
`;
document.body.append(root);

const connection = root.querySelector<HTMLParagraphElement>("#spike-connection")!;
const outputLine = root.querySelector<HTMLParagraphElement>("#spike-output")!;
const capturesList = root.querySelector<HTMLUListElement>("#spike-captures")!;
const logList = root.querySelector<HTMLOListElement>("#spike-log")!;
const fadeInput = root.querySelector<HTMLInputElement>("#spike-fade")!;

function appendLog(text: string): void {
  const item = document.createElement("li");
  item.textContent = text;
  logList.prepend(item);
}

chrome.runtime.onMessage.addListener((message: SpikeMessage) => {
  if (message.type === "spike:log") appendLog(message.text);
});

// ---------------------------------------------------------------- server connection

let socket: WebSocket | undefined;

function connect(): void {
  const ws = new WebSocket(SERVER_URL);
  socket = ws;
  connection.textContent = `Connecting to ${SERVER_URL}…`;
  ws.addEventListener("open", () => {
    connection.textContent = `Connected to ${SERVER_URL}`;
    request({ type: "hello", role: "control" });
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (message.type === "state") render(message.state);
    else if (message.type === "log") appendLog(`${new Date().toLocaleTimeString()} ${message.text}`);
  });
  ws.addEventListener("close", () => {
    connection.textContent = "Server not reachable. Retrying every 2 s.";
    capturesList.replaceChildren();
    rows.clear();
    outputLine.textContent = "";
    setTimeout(connect, 2000);
  });
}

function request(message: ControlRequest): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

connect();

// ---------------------------------------------------------------- rendering

function deviceText(label: string, info: ServerState["output"] | null): string {
  if (!info) return "";
  return `${label}: ${info.ok ? "✓" : "✗"} "${info.device}" via ${info.backend}${info.error ? ` (${info.error})` : ""}`;
}

interface Row {
  item: HTMLLIElement;
  title: HTMLDivElement;
  stats: HTMLDivElement;
  slider: HTMLInputElement;
  dragging: boolean;
}

/**
 * Rows are created once per source and then updated in place. Round 1 rebuilt every
 * row each second, so a click landing during a rebuild was lost (SM-05).
 */
const rows = new Map<number, Row>();

function createRow(tabId: number): Row {
  const item = document.createElement("li");
  const title = document.createElement("div");
  const stats = document.createElement("div");
  stats.className = "hint";
  const slider = Object.assign(document.createElement("input"), { type: "range", min: "0", max: "1", step: "0.01" });
  const row: Row = { item, title, stats, slider, dragging: false };
  slider.addEventListener("pointerdown", () => (row.dragging = true));
  // Released anywhere (even outside the slider) ends the drag.
  window.addEventListener("pointerup", () => (row.dragging = false));
  slider.addEventListener("change", () => (row.dragging = false));
  slider.addEventListener("input", () => request({ type: "set-gain", tabId, gain: Number(slider.value) }));

  const fade = Object.assign(document.createElement("button"), { textContent: "Crossfade to" });
  fade.addEventListener("click", () => request({ type: "crossfade", tabId, seconds: Number(fadeInput.value) }));
  const stop = Object.assign(document.createElement("button"), { textContent: "Stop" });
  stop.addEventListener("click", () => request({ type: "stop-source", tabId }));

  item.append(title, stats, slider, fade, stop);
  capturesList.append(item);
  return row;
}

function render(state: ServerState): void {
  const t = state.timing;
  outputLine.textContent =
    `${deviceText("Output", state.output)}. ${deviceText("Monitor", state.monitor)}` +
    ` Extension capture client: ${state.captureConnected ? "connected" : "not connected"}. ` +
    `Server latency ≈ ${t.serverLatencyMs.toFixed(0)} ms (jitter ${t.jitterTargetMs} + queue ${t.outputQueuedMs} + device ${t.deviceLatencyMs?.toFixed(1) ?? "?"}), ` +
    `render gap max ${t.maxRenderGapMs.toFixed(1)} ms (worst ${t.worstRenderGapMs.toFixed(1)}).`;

  const present = new Set(state.sources.map((s) => s.tabId));
  for (const [tabId, row] of rows) {
    if (!present.has(tabId)) {
      row.item.remove();
      rows.delete(tabId);
    }
  }
  for (const source of state.sources) {
    let row = rows.get(source.tabId);
    if (!row) {
      row = createRow(source.tabId);
      rows.set(source.tabId, row);
    }
    const active = source.tabId === state.activeTabId ? "▶ " : "";
    row.title.textContent = `${active}${source.label} (tab ${source.tabId})`;
    row.stats.textContent =
      `gain ${source.gain.toFixed(2)}${source.gain !== source.targetGain ? ` → ${source.targetGain.toFixed(2)}` : ""}, ` +
      `buffer ${source.bufferMs.toFixed(0)} ms${source.primed ? "" : " (filling)"}, ` +
      `underruns ${source.underruns}, overflow ${source.overflowFrames}, seq gaps ${source.seqGaps}, ` +
      `arrival gap max ${source.maxArrivalGapMs.toFixed(1)} ms (worst ${source.worstArrivalGapMs.toFixed(1)})`;
    // Don't move the slider under the user's finger.
    if (!row.dragging) row.slider.value = String(source.targetGain);
  }
}
