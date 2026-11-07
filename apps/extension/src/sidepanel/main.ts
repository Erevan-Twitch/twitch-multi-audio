import { PANEL_PORT_NAME, type PanelMessage, type TabEntry } from "../messages.js";

const list = document.querySelector<HTMLUListElement>("#tabs")!;
const emptyState = document.querySelector<HTMLParagraphElement>("#empty")!;

const MUTE_LABELS: Record<TabEntry["muted"], string> = {
  none: "",
  extension: "Muted by Twitch Multi Audio",
  user: "Muted",
};

function renderTab(tab: TabEntry): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "tab";
  item.classList.toggle("active", tab.active);

  const icon = document.createElement("img");
  icon.className = "favicon";
  icon.alt = "";
  if (tab.favIconUrl) icon.src = tab.favIconUrl;
  // Some favicons (chrome:// pages, broken URLs) can't be loaded here.
  icon.addEventListener("error", () => icon.removeAttribute("src"));

  const text = document.createElement("div");
  text.className = "text";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = tab.title || "Untitled";
  const site = document.createElement("span");
  site.className = "site";
  site.textContent = tab.site;
  text.append(title, site);

  const audio = document.createElement("span");
  audio.className = "audio";
  if (tab.muted !== "none") {
    audio.textContent = "🔇";
    audio.title = MUTE_LABELS[tab.muted];
  } else if (tab.audible) {
    audio.textContent = "🔊";
    audio.title = "Playing audio";
  } else {
    audio.textContent = "⏸";
    audio.title = "Silent (paused or muted in the player)";
  }

  item.append(icon, text, audio);
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
