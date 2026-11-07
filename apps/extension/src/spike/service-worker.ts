/**
 * SPIKE (throwaway): multi-tab capture test. Service worker side.
 * Triggers: context menu entry, keyboard shortcut (both grant activeTab), and
 * stream IDs obtained by the side panel's button.
 */
import { OFFSCREEN_PATH, errorText, log, send, type CaptureTrigger, type SpikeMessage } from "./messages.js";

const MENU_ID = "spike-capture-tab";
const COMMAND = "spike-capture-tab";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: "Spike: capture this tab's audio", contexts: ["all"] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab) void captureFromWorker(tab, "context-menu");
});

// SC-10: the toolbar click captures the tab, then opens the panel. Fires only
// because openPanelOnActionClick is false.
chrome.action.onClicked.addListener((tab) => {
  // sidePanel.open needs the click's user gesture: call it first, without waiting.
  chrome.sidePanel
    .open({ windowId: tab.windowId })
    .catch((error: unknown) => log(`✗ sidePanel.open failed: ${errorText(error)}`));
  void captureFromWorker(tab, "toolbar-icon");
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === COMMAND && tab) void captureFromWorker(tab, "shortcut");
});

chrome.runtime.onMessage.addListener((message: SpikeMessage, _sender, sendResponse) => {
  if (message.type !== "spike:attach") return;
  void chrome.tabs
    .get(message.tabId)
    .then((tab) => startPlayback(tab, message.streamId, message.trigger))
    .then(() => sendResponse(true));
  return true;
});

async function captureFromWorker(tab: chrome.tabs.Tab, trigger: CaptureTrigger): Promise<void> {
  if (tab.id === undefined) return;
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    await startPlayback(tab, streamId, trigger);
  } catch (error) {
    log(`✗ getMediaStreamId failed (${trigger}, tab ${tab.id} "${tab.title}"): ${errorText(error)}`);
  }
}

async function startPlayback(tab: chrome.tabs.Tab, streamId: string, trigger: CaptureTrigger): Promise<void> {
  if (tab.id === undefined) return;
  // The stream ID expires after a few seconds: the offscreen document must exist right away.
  await ensureOffscreen();
  const label = `${tab.title ?? "Untitled"} (${new URL(tab.url ?? "about:blank").hostname})`;
  const result = await send<string>({ type: "spike:capture", tabId: tab.id, streamId, label });
  const captured = await chrome.tabCapture.getCapturedTabs();
  log(
    `${result === "ok" ? "✓" : "✗"} capture via ${trigger}, tab ${tab.id}: ${result ?? "no answer from offscreen"}. ` +
      `getCapturedTabs: ${captured.map((c) => `${c.tabId}=${c.status}`).join(", ") || "none"}`,
  );
}

let creating: Promise<void> | undefined;
async function ensureOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (contexts.length > 0) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "Play back captured tab audio (multi-tab capture spike).",
    })
    .finally(() => (creating = undefined));
  await creating;
}
