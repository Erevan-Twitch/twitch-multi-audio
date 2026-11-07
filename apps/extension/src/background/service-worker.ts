import { PANEL_PORT_NAME, type PanelMessage, type TabEntry } from "../messages.js";

// Open the side panel when the toolbar icon is clicked.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error("Failed to set side panel behavior", error));
});

// The tab list is always rebuilt from chrome.tabs, so nothing is lost when
// Chrome stops this service worker.
async function getTabs(): Promise<TabEntry[]> {
  const tabs = await chrome.tabs.query({audible: true});
  return tabs.flatMap((tab) => {
    if (tab.id === undefined || tab.id === chrome.tabs.TAB_ID_NONE) return [];
    const entry: TabEntry = {
      id: tab.id,
      windowId: tab.windowId,
      title: tab.title ?? "",
      active: tab.active,
      audible: tab.audible ?? false,
      muted: tab.mutedInfo?.muted ?? false,
    };
    if (tab.url) entry.url = tab.url;
    if (tab.favIconUrl) entry.favIconUrl = tab.favIconUrl;
    return [entry];
  });
}

// Connected side panels (one per window can be open).
const panelPorts = new Set<chrome.runtime.Port>();

async function sendSnapshot(ports: Iterable<chrome.runtime.Port>): Promise<void> {
  const message: PanelMessage = { type: "tabs:snapshot", tabs: await getTabs() };
  for (const port of ports) port.postMessage(message);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT_NAME) return;
  panelPorts.add(port);
  port.onDisconnect.addListener(() => panelPorts.delete(port));
  void sendSnapshot([port]);
});

// Tab events often arrive in bursts (a page load fires several onUpdated),
// so they are grouped into a single snapshot.
let broadcastTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleBroadcast(): void {
  if (panelPorts.size === 0) return;
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => void sendSnapshot(panelPorts), 100);
}

// Listeners must be registered at the top level so Chrome can wake the worker.
chrome.tabs.onCreated.addListener(scheduleBroadcast);
chrome.tabs.onUpdated.addListener(scheduleBroadcast);
chrome.tabs.onRemoved.addListener(scheduleBroadcast);
chrome.tabs.onMoved.addListener(scheduleBroadcast);
chrome.tabs.onActivated.addListener(scheduleBroadcast);
chrome.tabs.onAttached.addListener(scheduleBroadcast);
chrome.tabs.onDetached.addListener(scheduleBroadcast);
chrome.tabs.onReplaced.addListener(scheduleBroadcast);
