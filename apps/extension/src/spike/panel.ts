/**
 * SPIKE (throwaway): multi-tab capture test. Side panel controls: capture the
 * active tab from a panel button, list captures with gain sliders, crossfade, stop.
 */
import { errorText, send, type SpikeMessage, type SpikeStatus } from "./messages.js";

const root = document.createElement("section");
root.className = "spike";
root.innerHTML = `
  <h2>Spike: tab capture</h2>
  <p class="hint">Capture with: right-click the page → "Spike: capture this tab's audio", the shortcut (chrome://extensions/shortcuts), or the button below (active tab).</p>
  <button id="spike-panel-capture">Capture active tab (panel button)</button>
  <label class="fade">Crossfade duration <input id="spike-fade" type="number" min="0" max="10" step="0.5" value="2" /> s</label>
  <ul id="spike-captures"></ul>
  <p id="spike-latency" class="hint"></p>
  <h3>Log</h3>
  <ol id="spike-log"></ol>
`;
document.body.append(root);

const capturesList = root.querySelector<HTMLUListElement>("#spike-captures")!;
const logList = root.querySelector<HTMLOListElement>("#spike-log")!;
const latency = root.querySelector<HTMLParagraphElement>("#spike-latency")!;
const fadeInput = root.querySelector<HTMLInputElement>("#spike-fade")!;

root.querySelector("#spike-panel-capture")!.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) return;
  try {
    // Called from the panel, with this click as the user gesture.
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    await send({ type: "spike:attach", tabId: tab.id, streamId, trigger: "panel-button" });
  } catch (error) {
    log(`✗ getMediaStreamId failed (panel-button, tab ${tab.id} "${tab.title}"): ${errorText(error)}`);
  }
});

function appendLog(text: string): void {
  const item = document.createElement("li");
  item.textContent = text;
  logList.prepend(item);
}

// Messages never reach the context that sent them, so the panel logs its own lines directly.
function log(text: string): void {
  console.log(`[spike] ${text}`);
  appendLog(`${new Date().toLocaleTimeString()} ${text}`);
}

chrome.runtime.onMessage.addListener((message: SpikeMessage) => {
  if (message.type === "spike:log") appendLog(message.text);
});

function renderStatus(status: SpikeStatus | undefined): void {
  const captures = status?.captures ?? [];
  // Don't rebuild while a slider is being dragged.
  if (capturesList.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement) return;
  capturesList.replaceChildren(
    ...captures.map((capture) => {
      const item = document.createElement("li");
      const title = document.createElement("div");
      title.textContent = `${capture.label} (tab ${capture.tabId}, track ${capture.trackState})`;

      const slider = Object.assign(document.createElement("input"), {
        type: "range",
        min: "0",
        max: "1",
        step: "0.01",
        value: String(capture.gain),
      });
      slider.addEventListener("input", () => void send({ type: "spike:gain", tabId: capture.tabId, gain: Number(slider.value) }));

      const fade = Object.assign(document.createElement("button"), { textContent: "Crossfade to" });
      fade.addEventListener("click", () => void send({ type: "spike:crossfade", toTabId: capture.tabId, seconds: Number(fadeInput.value) }));

      const stop = Object.assign(document.createElement("button"), { textContent: "Stop" });
      stop.addEventListener("click", () => void send({ type: "spike:stop", tabId: capture.tabId }));

      item.append(title, slider, fade, stop);
      return item;
    }),
  );
  latency.textContent = status
    ? `AudioContext latency: base ${(status.baseLatency * 1000).toFixed(1)} ms, output ${(status.outputLatency * 1000).toFixed(1)} ms`
    : "No offscreen document yet.";
}

setInterval(() => void send<SpikeStatus>({ type: "spike:status" }).then(renderStatus), 1000);
