import { PANEL_PORT_NAME, type MuteState, type PanelMessage, type TabEntry } from "../messages.js";

// Open the side panel when the toolbar icon is clicked.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error("Failed to set side panel behavior", error));
});

// --- Identified tabs ----------------------------------------------------------
// See "How tabs are identified" in docs/roadmap.md. `audible` only adds a tab;
// once identified, a tab stays until it closes or moves to a different site.
// The set lives in storage.local so it survives the service worker stopping and
// the extension reloading or updating (storage.session is wiped on reload).
// Tab IDs are only valid for one browser session, so it's cleared on browser start.

const STORAGE_KEY = "identifiedTabs";
/** Tab ID (as a string, since it's a JSON key) → site the tab was identified on. */
type IdentifiedTabs = Record<string, string>;

async function loadIdentified(): Promise<IdentifiedTabs> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as IdentifiedTabs | undefined) ?? {};
}

async function saveIdentified(identified: IdentifiedTabs): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: identified });
}

function siteOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function muteStateOf(tab: chrome.tabs.Tab): MuteState {
  const info = tab.mutedInfo;
  if (!info?.muted) return "none";
  return info.reason === "extension" && info.extensionId === chrome.runtime.id ? "extension" : "user";
}

function hasAudioSignal(tab: chrome.tabs.Tab): boolean {
  return (tab.audible ?? false) || (tab.mutedInfo?.muted ?? false);
}

function toEntry(tab: chrome.tabs.Tab & { id: number }): TabEntry {
  const entry: TabEntry = {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title ?? "",
    site: siteOf(tab.url),
    active: tab.active,
    audible: tab.audible ?? false,
    muted: muteStateOf(tab),
  };
  if (tab.favIconUrl) entry.favIconUrl = tab.favIconUrl;
  return entry;
}

/** Re-applies the identification rule to the current tabs and returns the identified ones. */
async function refreshIdentified(): Promise<TabEntry[]> {
  const [tabs, previous] = await Promise.all([chrome.tabs.query({}), loadIdentified()]);
  const next: IdentifiedTabs = {};
  const entries: TabEntry[] = [];

  for (const tab of tabs) {
    if (tab.id === undefined || tab.id === chrome.tabs.TAB_ID_NONE) continue;
    const site = siteOf(tab.url);
    const stillOnSameSite = previous[tab.id] !== undefined && previous[tab.id] === site;
    if (hasAudioSignal(tab) || stillOnSameSite) {
      next[tab.id] = site;
      entries.push(toEntry({ ...tab, id: tab.id }));
    }
  }

  // Closed tabs aren't in the query anymore, so they drop out of `next`.
  if (JSON.stringify(next) !== JSON.stringify(previous)) await saveIdentified(next);
  return entries;
}

// Storage reads and writes from overlapping events could overwrite each other,
// so every update runs one after the other.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task);
  queue = result.catch((error: unknown) => console.error("Tab update failed", error));
  return result;
}

// --- Side panel connections ---------------------------------------------------

const panelPorts = new Set<chrome.runtime.Port>();

function broadcast(tabs: TabEntry[], ports: Iterable<chrome.runtime.Port> = panelPorts): void {
  const message: PanelMessage = { type: "tabs:snapshot", tabs };
  for (const port of ports) port.postMessage(message);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT_NAME) return;
  panelPorts.add(port);
  port.onDisconnect.addListener(() => panelPorts.delete(port));
  void enqueue(refreshIdentified).then((tabs) => broadcast(tabs, [port]));
});

// --- Tab events -----------------------------------------------------------------
// Updates run even when no panel is open, so a tab that plays briefly while the
// panel is closed is still identified. Events arriving in bursts (a page load
// fires several onUpdated) are grouped into one update.

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleRefresh(): void {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void enqueue(refreshIdentified).then((tabs) => broadcast(tabs)), 100);
}

// A tab can be swapped for another one with a new ID (prerendering): carry its identification over.
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  void enqueue(async () => {
    const identified = await loadIdentified();
    const site = identified[removedTabId];
    if (site === undefined) return;
    delete identified[removedTabId];
    identified[addedTabId] = site;
    await saveIdentified(identified);
  });
  scheduleRefresh();
});

// New browser session: previous tab IDs may now point to unrelated tabs.
chrome.runtime.onStartup.addListener(() => {
  void enqueue(() => chrome.storage.local.remove(STORAGE_KEY));
  scheduleRefresh();
});

// Listeners must be registered at the top level so Chrome can wake the worker.
chrome.tabs.onCreated.addListener(scheduleRefresh);
chrome.tabs.onUpdated.addListener(scheduleRefresh);
chrome.tabs.onRemoved.addListener(scheduleRefresh);
chrome.tabs.onMoved.addListener(scheduleRefresh);
chrome.tabs.onActivated.addListener(scheduleRefresh);
chrome.tabs.onAttached.addListener(scheduleRefresh);
chrome.tabs.onDetached.addListener(scheduleRefresh);

// Catch tabs already playing when the worker starts (install, reload, browser start).
scheduleRefresh();
