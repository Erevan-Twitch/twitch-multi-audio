/**
 * SPIKE (throwaway): multi-tab capture test. Offscreen document: turns stream IDs
 * into audio, mixes every captured tab through its own gain, and plays the mix.
 * Inspect it from chrome://extensions → "Inspect views: offscreen.html".
 */
import { errorText, log, type CaptureView, type SpikeMessage, type SpikeStatus } from "./messages.js";

interface Capture {
  label: string;
  stream: MediaStream;
  gain: GainNode;
  startedAt: number;
}

const context = new AudioContext();
const captures = new Map<number, Capture>();

async function capture(tabId: number, streamId: string, label: string): Promise<string> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } } as MediaTrackConstraints,
      video: false,
    });
    const gain = context.createGain();
    // A captured tab is silent for the user: playing it here keeps it audible.
    context.createMediaStreamSource(stream).connect(gain).connect(context.destination);
    await context.resume();

    const [track] = stream.getAudioTracks();
    track?.addEventListener("ended", () => {
      log(`track ended for tab ${tabId} (${label})`);
      remove(tabId);
    });

    remove(tabId);
    captures.set(tabId, { label, stream, gain, startedAt: Date.now() });
    return "ok";
  } catch (error) {
    return `getUserMedia failed: ${errorText(error)}`;
  }
}

function remove(tabId: number): void {
  const existing = captures.get(tabId);
  if (!existing) return;
  existing.stream.getTracks().forEach((track) => track.stop());
  existing.gain.disconnect();
  captures.delete(tabId);
}

function setGain(tabId: number, value: number): void {
  const capture = captures.get(tabId);
  if (!capture) return;
  capture.gain.gain.cancelScheduledValues(context.currentTime);
  capture.gain.gain.setValueAtTime(value, context.currentTime);
}

/** Ramps the chosen tab to 1 and every other one to 0. */
function crossfade(toTabId: number, seconds: number): void {
  const now = context.currentTime;
  for (const [tabId, capture] of captures) {
    const param = capture.gain.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(tabId === toTabId ? 1 : 0, now + Math.max(seconds, 0.01));
  }
  log(`crossfade to tab ${toTabId} over ${seconds}s`);
}

function status(): SpikeStatus {
  const views: CaptureView[] = [...captures].map(([tabId, c]) => ({
    tabId,
    label: c.label,
    gain: c.gain.gain.value,
    trackState: c.stream.getAudioTracks()[0]?.readyState ?? "ended",
    startedAt: c.startedAt,
  }));
  return { captures: views, baseLatency: context.baseLatency, outputLatency: context.outputLatency };
}

chrome.runtime.onMessage.addListener((message: SpikeMessage, _sender, sendResponse) => {
  switch (message.type) {
    case "spike:capture":
      void capture(message.tabId, message.streamId, message.label).then(sendResponse);
      return true;
    case "spike:status":
      sendResponse(status());
      return;
    case "spike:gain":
      setGain(message.tabId, message.gain);
      return;
    case "spike:crossfade":
      crossfade(message.toTabId, message.seconds);
      return;
    case "spike:stop":
      remove(message.tabId);
      log(`stopped tab ${message.tabId}`);
      return;
    default:
      return;
  }
});
