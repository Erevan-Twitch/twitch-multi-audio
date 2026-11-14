/**
 * SPIKE (throwaway): server-side mix test (started from the tab capture spike). Service worker side.
 * Triggers that grant activeTab: context menu, keyboard shortcut, toolbar button.
 * Also reports captured tabs that move to another site, for the server to decide.
 */
import { OFFSCREEN_PATH, errorText, log, send, type CaptureTrigger } from "./messages.js";

const MENU_ID = "spike-capture-tab";
const COMMAND = "spike-capture-tab";
/** tabId → site at capture time. In storage.session so it survives the worker stopping. */
const SITES_KEY = "spikeCapturedSites";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: "Spike: send this tab's audio to the server", contexts: ["all"] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab) void captureFromWorker(tab, "context-menu");
});

// The toolbar click captures the tab, then opens the panel. Fires only
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

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url) return;
  void (async () => {
    const sites = await capturedSites();
    const fromSite = sites[tabId];
    const toSite = siteOf(change.url);
    if (fromSite === undefined || fromSite === toSite) return;
    log(`tab ${tabId} moved from ${fromSite} to ${toSite}: reported to the server`);
    delete sites[tabId];
    await chrome.storage.session.set({ [SITES_KEY]: sites });
    await send({ type: "spike:navigated", tabId, fromSite, toSite });
  })();
});

async function captureFromWorker(tab: chrome.tabs.Tab, trigger: CaptureTrigger): Promise<void> {
  if (tab.id === undefined) return;
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    await startCapture(tab, streamId, trigger);
  } catch (error) {
    log(`✗ getMediaStreamId failed (${trigger}, tab ${tab.id} "${tab.title}"): ${errorText(error)}`);
  }
}

async function startCapture(tab: chrome.tabs.Tab, streamId: string, trigger: CaptureTrigger): Promise<void> {
  if (tab.id === undefined) return;
  // The stream ID expires after a few seconds: the offscreen document must exist right away.
  await ensureOffscreen();
  const site = siteOf(tab.url);
  const label = `${tab.title ?? "Untitled"} (${site})`;
  const result = await send<string>({ type: "spike:capture", tabId: tab.id, streamId, label });
  if (result === "ok") {
    const sites = await capturedSites();
    await chrome.storage.session.set({ [SITES_KEY]: { ...sites, [tab.id]: site } });
  }
  const captured = await chrome.tabCapture.getCapturedTabs();
  log(
    `${result === "ok" ? "✓" : "✗"} capture via ${trigger}, tab ${tab.id}: ${result ?? "no answer from offscreen"}. ` +
      `getCapturedTabs: ${captured.map((c) => `${c.tabId}=${c.status}`).join(", ") || "none"}`,
  );
}

async function capturedSites(): Promise<Record<number, string>> {
  const stored = await chrome.storage.session.get(SITES_KEY);
  return (stored[SITES_KEY] as Record<number, string> | undefined) ?? {};
}

function siteOf(url: string | undefined): string {
  try {
    return new URL(url ?? "").hostname;
  } catch {
    return "";
  }
}

let creating: Promise<void> | undefined;
async function ensureOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (contexts.length > 0) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "Capture tab audio and stream it to the local mixing server (spike).",
    })
    .finally(() => (creating = undefined));
  await creating;
}
