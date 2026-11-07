import { PANEL_PORT_NAME, type PanelMessage, type TabEntry } from "../messages.js";
import "../spike/panel.js"; // SPIKE (throwaway): multi-tab capture test

const list = document.querySelector<HTMLUListElement>("#tabs")!;
const emptyState = document.querySelector<HTMLParagraphElement>("#empty")!;

const MUTE_LABELS: Record<TabEntry["muted"], string> = {
  none: "",
  extension: "Muted by Twitch Multi Audio",
  user: "Muted (tab)",
};

function status(tab: TabEntry): { icon: string; label: string } {
  if (tab.muted !== "none") return { icon: "🔇", label: MUTE_LABELS[tab.muted] };
  const playing = tab.audible || tab.media?.playbackState === "playing";
  if (playing && tab.media?.playerMuted) {
    return { icon: "🔈", label: "Muted in the player: unmute it in the page" };
  }
  if (tab.silentWhilePlaying) {
    return { icon: "🔈", label: "Playing but silent: probably muted in the player" };
  }
  if (playing) return { icon: "🔊", label: "Playing" };
  return { icon: "⏸", label: "Paused" };
}

function image(className: string, src: string | undefined, fallback?: string): HTMLImageElement {
  const img = document.createElement("img");
  img.className = className;
  img.alt = "";
  if (src) img.src = src;
  // Some images (chrome:// favicons, blob: covers, broken URLs) can't be loaded here.
  img.addEventListener("error", () => {
    if (fallback && img.src !== fallback) img.src = fallback;
    else img.removeAttribute("src");
  });
  return img;
}

function text(className: string, content: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = content;
  return span;
}

function renderTab(tab: TabEntry): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "tab";
  item.classList.toggle("active", tab.active);

  const track = tab.media?.track;
  const cover = track?.coverUrl
    ? image("cover", track.coverUrl, tab.favIconUrl)
    : image("cover placeholder", tab.favIconUrl);

  const details = document.createElement("div");
  details.className = "details";
  if (track) {
    details.append(text("title", track.title || tab.title || "Untitled"));
    if (track.artist) details.append(text("artist", track.artist));
  } else {
    details.append(text("title", tab.title || "Untitled"));
    details.append(text("artist no-track", "No track info"));
  }

  const site = document.createElement("span");
  site.className = "site";
  site.append(image("favicon", tab.favIconUrl), document.createTextNode(tab.site));
  details.append(site);

  const { icon, label } = status(tab);
  const state = text("state", icon);
  state.title = label;
  state.setAttribute("aria-label", label);

  item.append(cover, details, state);
  return item;
}

function render(tabs: TabEntry[]): void {
  list.replaceChildren(...tabs.map(renderTab));
  emptyState.hidden = tabs.length > 0;
}

// Chrome can stop the service worker, which closes the port: reconnect.
function connect(): void {
  const port = chrome.runtime.connect({ name: PANEL_PORT_NAME });
  port.onMessage.addListener((message: PanelMessage) => {
    if (message.type === "tabs:snapshot") render(message.tabs);
  });
  port.onDisconnect.addListener(() => setTimeout(connect, 500));
}

connect();
