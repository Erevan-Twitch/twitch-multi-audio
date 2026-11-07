# Roadmap

## Context

The local server is the mixer: it receives every audio source, picks which one plays, and will handle crossfades and per-source volume later. The browser extension is one source provider among others. Desktop apps such as Spotify will be added later as sources captured at the OS level.

Audio from browser tabs will be captured with `chrome.tabCapture` (one user action per tab to add it as a source). See [Chrome APIs](#chrome-apis) below.

## Version 1: the side panel lists identified tabs

Goal: the extension's side panel shows the tabs it has identified, with title, artist and cover. Audio capture, the WebSocket connection and the server are out of scope.

### Decisions to make first

- [x] **What counts as an "identified" tab?** Suggestion: tabs that are currently playing, plus tabs that publish track info but are paused. Then a paused song doesn't disappear from the list.
  - Answer: tabs that are currently playing audio, and tabs that publish track info but are pause.
- [x] **Which sites can the extension read?** Track info needs permission to run code in the page. Either a fixed list of music sites (shorter permission warning, but each new site needs an update) or all sites.
  - Answer: all tabs
- [x] **Where does the tab list live?**
  - Option 1: the panel reads Chrome directly. Simplest, but the list only exists while the panel is open.
  - Option 2 (recommended): the background service worker keeps the list and the panel shows it. That's where the server connection will run later, so this avoids a rewrite. Chrome stops idle service workers, so the list must be rebuilt by asking Chrome again, or saved in `chrome.storage.session`.
  - Answer: Option 2. The set of identified tabs is saved in `chrome.storage.local`: it survives Chrome stopping the service worker and the extension reloading or updating (`storage.session` is wiped on reload). It's cleared on browser start (`runtime.onStartup`), since tab IDs are only valid for one browser session.

### How tabs are identified

`Tab.audible` only means "produced sound in the past couple of seconds". It stays `true` when a tab is muted at the tab level, but turns `false` when the tab is paused or muted in the player (e.g. YouTube's mute button). So it's a signal that adds a tab, never the rule for keeping one.

- **A tab joins the list** when any of these is true:
  - `audible` is `true`.
  - `mutedInfo.muted` is `true` (muted at the tab level).
  - The content script finds track info (`navigator.mediaSession.metadata`). This catches paused tabs and tabs muted in the player. *(Step 2)*
  - The tab is being captured (`chrome.tabCapture.getCapturedTabs()`). *(Version 2)*
- **It stays in the list** until the tab closes, or it moves to a different site, or the page clears its track info and has been silent for a while *(Step 2)*. Going silent, being muted or pausing doesn't remove it.
- **The panel shows the state** instead of filtering on it: playing, paused, muted by the extension (`mutedInfo.reason === "extension"`), muted by the user, muted in the player.
- **Muting is done at the tab level** (`chrome.tabs.update(id, { muted })`), never in the player. A tab muted in the player can't be unmuted that way, so the panel flags it for the streamer.

### Step 1: list playing tabs (tabs API only)

- [x] Add the `"tabs"` permission to the manifest. Check that tab titles, URLs and icons now come through.
- [x] Define a "tab source" type: tab ID, tab title, site, favicon, playing or not. Keep it in the extension for now; move it to `@tma/shared` when the server needs it.
- [x] Service worker: identify tabs with the rule above (`audible` or `mutedInfo.muted` for now) and save their IDs and sites in `chrome.storage.local`, cleared on browser start (needs the `"storage"` permission).
- [x] Service worker: keep the list current with the `tabs` events (`onUpdated`, `onRemoved`, `onReplaced`, etc.). Drop a tab when it closes or moves to a different site.
- [x] Messaging: the panel asks for the current list when it opens, then receives updates over a `chrome.runtime` port.
- [x] Panel: show the list (icon, title, site, playing/muted/silent) and an empty state.
- [x] Manual check: start and stop audio in two or three tabs, pause one, mute one at the tab level and one in the player, close a tab, navigate a tab to another site, reload the extension, and close and reopen the panel.

### Step 2: track info (title, artist, cover)

- [x] Add host permissions for the chosen sites (all `http`/`https` pages, plus the `"scripting"` permission).
- [x] **Test first:** can a content script read `navigator.mediaSession.metadata`, or does that only work in the page's own JavaScript context (`world: "MAIN"`)? Answer: the content script (isolated world) can read it. TI-01 passed on SoundCloud, YouTube and Chillhop.
- [x] Choose how to detect track changes: the content script checks every second and sends updates only when something changes. A cleared track is only reported after 10 s, to ignore gaps between songs.
- [x] Include the paused/playing state (`playbackState`), so paused tabs can stay in the list per the first decision. When the page doesn't declare it, it's derived from the page's `<audio>`/`<video>` elements.
- [x] Identification: a tab that publishes track info joins the list even when silent. Remove a tab once its track info is cleared and it is silent. Tabs that never had track info stay until closed or moved to another site.
- [x] Detect "muted in the player" (`muted` or `volume === 0` on the page's media elements) and flag it in the panel.
  - Elements with the `muted` attribute in the HTML (decorative background videos) are ignored.
  - Elements kept out of the page (`new Audio()`, e.g. Chillhop) are caught by a page-context script (`content/page-hook.ts`, `world: "MAIN"`, from `document_start`) that wraps `HTMLMediaElement.prototype.play`. The content script asks it for their state through DOM events. Chillhop "mutes" with `volume = 0`, which Chrome still reports as `audible`, so only this catches it.
  - Fallback when no element can be checked (pure Web Audio): the page says it's playing but the tab isn't `audible` for 3 s → "probably muted in the player".
- [x] Cover existing tabs: content scripts declared in the manifest don't run in tabs that were already open when the extension installs or reloads. Inject into those with `chrome.scripting.executeScript` on `runtime.onInstalled` (install, update, reload). Not needed at browser start: restored tabs load normally and get the manifest content script.
- [x] Fallback when a site doesn't publish track info: use the tab title, and mark the entry as "no track info".
- [x] Artwork: pick the largest image the page offers.
- [x] Panel: show cover, title and artist for each tab, then site and favicon.
- [x] Manual check: [apps/extension/test/cases/02-track-info.md](../apps/extension/test/cases/02-track-info.md).

### Step 3: make it reliable

- [x] Test on YouTube, YouTube Music, Spotify Web, SoundCloud and Deezer, or whatever is actually used on stream. Note which sites publish track info.
- [x] Edge cases:
  - Moving to a new page inside the same tab, or a single-page site changing view without a reload.
  - Several tabs on the same site.
  - A tab moved to another window.
  - Chrome stopping the service worker while the panel is open.
- [x] Add an extension icon so it's easy to find in the toolbar.

## Version 2 (later)

### Test A: multi-tab capture (done)

- [x] Confirm that several tabs can be captured at the same time. Yes: see [docs/spikes/tab-capture.md](spikes/tab-capture.md) (code on the `spike/tab-capture` branch, not merged).

Rules that came out of it:
- **Adding a tab as a source** starts from something Chrome counts as invoking the extension on that tab (it grants `activeTab`):
  - the **toolbar button**: set `openPanelOnActionClick: false`, capture in `action.onClicked`, then open the panel with `chrome.sidePanel.open()`
  - the **context menu** ("Add as audio source")
  - a **keyboard shortcut** (`commands`)
- **Never from the side panel:** a panel click doesn't grant `activeTab`. The panel only controls existing captures (volume, switching, crossfade, stop).
- **A capture stops when its tab moves to another site.** Chrome keeps it running, so the extension stops it, consistent with the tab list's rule. Same-site navigation (next song) keeps it.
- **A tab that's already captured** is shown as "already a source", not as an error.

### Test B: where the mix happens and how it reaches OBS

- [ ] Decide between mixing in the extension's offscreen document and outputting to a virtual device (`AudioContext.setSinkId()`, e.g. BlackHole), or mixing on the server. Test the first: test A already showed mixing and crossfades work there.

### Then

- Pick tabs as sources (`activeTab` + `tabCapture`) with the rules above.
- Captured tabs (`chrome.tabCapture.getCapturedTabs()`) always count as identified.
- Offscreen document for audio processing.
- WebSocket connection to the server, sending track info (and audio, if the mix happens on the server).

## Chrome APIs

- Tabs: https://developer.chrome.com/docs/extensions/reference/api/tabs
- Permissions: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
- Content scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Scripting: https://developer.chrome.com/docs/extensions/reference/api/scripting
- Messaging: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- Media Session API: https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API
- Tab capture: https://developer.chrome.com/docs/extensions/reference/api/tabCapture
- Audio recording and screen capture: https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture
- Offscreen documents: https://developer.chrome.com/docs/extensions/reference/api/offscreen
- Commands (keyboard shortcuts): https://developer.chrome.com/docs/extensions/reference/api/commands
