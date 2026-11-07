import {
  PANEL_PORT_NAME,
  type ContentMessage,
  type MediaState,
  type MuteState,
  type PanelMessage,
  type TabEntry,
} from "../messages.js";

import "../spike/service-worker.js"; // SPIKE (throwaway): multi-tab capture test

const CONTENT_SCRIPT_FILE = "content/media-session.js";
const PAGE_HOOK_FILE = "content/page-hook.js";

chrome.runtime.onInstalled.addListener(() => {
  // Open the side panel when the toolbar icon is clicked.
  // SPIKE (throwaway): false so the click reaches action.onClicked (SC-10). Restore to true.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch((error: unknown) => console.error("Failed to set side panel behavior", error));
  // Manifest content scripts only run in pages loaded after install/reload.
  void injectIntoOpenTabs();
});

async function injectIntoOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined || tab.discarded) return;
      try {
        // The hook only sees play() calls made after this, so a detached player
        // already playing is picked up at its next play() (e.g. next track).
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [PAGE_HOOK_FILE], world: "MAIN" });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [CONTENT_SCRIPT_FILE] });
      } catch {
        // Some pages can't be scripted (Chrome Web Store, error pages): skip them.
      }
    }),
  );
}

// --- Tab records ------------------------------------------------------------------
// See "How tabs are identified" in docs/roadmap.md.
// Records live in storage.local so they survive the service worker stopping and
// the extension reloading or updating (storage.session is wiped on reload).
// Tab IDs are only valid for one browser session, so they're cleared on browser start.

const STORAGE_KEY = "tabRecords";

interface TabRecord {
  /** Site the record belongs to: navigating to another site resets it. */
  site: string;
  identified: boolean;
  /** Had track info while identified: clearing it then removes the tab. */
  hadTrack: boolean;
  media?: MediaState;
}

/** Tab ID (as a string, since it's a JSON key) → record. */
type TabRecords = Record<string, TabRecord>;

async function loadRecords(): Promise<TabRecords> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as TabRecords | undefined) ?? {};
}

async function saveRecords(records: TabRecords): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: records });
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

/**
 * `audible` lags behind the start of playback by about a second, so a tab only
 * counts as "silent while playing" after this long.
 */
const SILENT_WHILE_PLAYING_DELAY_MS = 3000;

/**
 * When the tab will count as "silent while playing" if nothing changes:
 * undefined when it doesn't apply (an element was checked, not playing, audible).
 */
function silentWhilePlayingAt(tab: chrome.tabs.Tab, media: MediaState | undefined): number | undefined {
  if (!media || media.playerMuted !== null || media.playbackState !== "playing") return undefined;
  if (tab.audible || media.playingSince === undefined) return undefined;
  return media.playingSince + SILENT_WHILE_PLAYING_DELAY_MS;
}

function toEntry(tab: chrome.tabs.Tab & { id: number }, record: TabRecord, now: number): TabEntry {
  const silentAt = silentWhilePlayingAt(tab, record.media);
  const entry: TabEntry = {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title ?? "",
    site: record.site,
    active: tab.active,
    audible: tab.audible ?? false,
    muted: muteStateOf(tab),
    silentWhilePlaying: silentAt !== undefined && silentAt <= now,
  };
  if (tab.favIconUrl) entry.favIconUrl = tab.favIconUrl;
  if (record.media) entry.media = record.media;
  return entry;
}

/** Re-applies the identification rule to the current tabs and returns the identified ones. */
async function refreshRecords(): Promise<TabEntry[]> {
  const [tabs, previous] = await Promise.all([chrome.tabs.query({}), loadRecords()]);
  const next: TabRecords = {};
  const entries: TabEntry[] = [];
  const now = Date.now();
  // Earliest moment a tab will become "silent while playing": no tab event fires
  // then, so a refresh is scheduled for it.
  let nextSilentCheck: number | undefined;

  for (const tab of tabs) {
    if (tab.id === undefined || tab.id === chrome.tabs.TAB_ID_NONE) continue;
    const site = siteOf(tab.url);
    const stored = previous[tab.id];
    const prev = stored?.site === site ? stored : undefined;
    const media = prev?.media;
    const hasTrack = media?.track != null;

    const hasSignal =
      (tab.audible ?? false) ||
      (tab.mutedInfo?.muted ?? false) ||
      hasTrack ||
      media?.playbackState === "playing";
    const trackWasCleared = (prev?.hadTrack ?? false) && !hasTrack;
    const stays = (prev?.identified ?? false) && !trackWasCleared;
    const identified = hasSignal || stays;

    const record: TabRecord = { site, identified, hadTrack: identified && (hasTrack || (prev?.hadTrack ?? false)) };
    if (media) record.media = media;
    // Keep records for unidentified tabs only when they hold media info.
    if (identified || media) next[tab.id] = record;
    if (identified) {
      entries.push(toEntry({ ...tab, id: tab.id }, record, now));
      const silentAt = silentWhilePlayingAt(tab, media);
      if (silentAt !== undefined && silentAt > now) nextSilentCheck = Math.min(nextSilentCheck ?? silentAt, silentAt);
    }
  }

  if (nextSilentCheck !== undefined) setTimeout(scheduleRefresh, nextSilentCheck - now);

  // Closed tabs aren't in the query anymore, so they drop out of `next`.
  if (JSON.stringify(next) !== JSON.stringify(previous)) await saveRecords(next);
  return entries;
}

async function storeMedia(tabId: number, url: string | undefined, media: MediaState): Promise<void> {
  const records = await loadRecords();
  const site = siteOf(url);
  const prev = records[tabId];
  records[tabId] =
    prev?.site === site ? { ...prev, media } : { site, identified: false, hadTrack: false, media };
  await saveRecords(records);
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
  void enqueue(refreshRecords).then((tabs) => broadcast(tabs, [port]));
});

// --- Updates ------------------------------------------------------------------------
// Updates run even when no panel is open, so a tab that plays briefly while the
// panel is closed is still identified. Events arriving in bursts (a page load
// fires several onUpdated) are grouped into one update.

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleRefresh(): void {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void enqueue(refreshRecords).then((tabs) => broadcast(tabs)), 100);
}

chrome.runtime.onMessage.addListener((message: ContentMessage, sender) => {
  // Only the top frame's Media Session is used.
  if (message.type !== "media:update" || sender.tab?.id === undefined || sender.frameId !== 0) return;
  const tabId = sender.tab.id;
  void enqueue(() => storeMedia(tabId, sender.url, message.media));
  scheduleRefresh();
});

// A tab can be swapped for another one with a new ID (prerendering): carry its record over.
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  void enqueue(async () => {
    const records = await loadRecords();
    const record = records[removedTabId];
    if (record === undefined) return;
    delete records[removedTabId];
    records[addedTabId] = record;
    await saveRecords(records);
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
