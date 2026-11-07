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
  - Answer: Option 2

### Step 1: list playing tabs (tabs API only)

- [ ] Add the `"tabs"` permission to the manifest. Check that tab titles, URLs and icons now come through.
- [ ] Define a "tab source" type: tab ID, tab title, site, favicon, playing or not. Keep it in the extension for now; move it to `@tma/shared` when the server needs it.
- [ ] Service worker: build the list when it starts with `chrome.tabs.query({ audible: true })`.
- [ ] Service worker: keep the list current with `tabs.onUpdated` (playing, title and icon changes) and `tabs.onRemoved`.
- [ ] Messaging: the panel asks for the current list when it opens, then receives updates over a `chrome.runtime` port.
- [ ] Panel: show the list (icon, title, site) and an empty state ("No tab is playing audio").
- [ ] Manual check: start and stop audio in two or three tabs, close a tab, reload the extension, and close and reopen the panel.

### Step 2: track info (title, artist, cover)

- [ ] Add host permissions for the chosen sites.
- [ ] **Test first:** can a content script read `navigator.mediaSession.metadata`, or does that only work in the page's own JavaScript context (`world: "MAIN"`)? The answer decides how the next items are built.
- [ ] Choose how to detect track changes: check every second or so, or intercept the page setting `navigator.mediaSession.metadata` (needs the page context). Send updates only when something changes.
- [ ] Include the paused/playing state (`playbackState`), so paused tabs can stay in the list per the first decision.
- [ ] Cover existing tabs: content scripts declared in the manifest don't run in tabs that were already open when the extension installs or reloads. Inject into those with `chrome.scripting.executeScript` at install and at startup.
- [ ] Fallback when a site doesn't publish track info: use the tab title, and mark the entry as "no track info".
- [ ] Artwork: pick the largest image the page offers.
- [ ] Panel: show cover, title and artist for each tab, then site and favicon.

### Step 3: make it reliable

- [ ] Test on YouTube, YouTube Music, Spotify Web, SoundCloud and Deezer, or whatever is actually used on stream. Note which sites publish track info.
- [ ] Edge cases:
  - Moving to a new page inside the same tab, or a single-page site changing view without a reload.
  - Several tabs on the same site.
  - A tab moved to another window.
  - Chrome stopping the service worker while the panel is open.
- [ ] Add an extension icon so it's easy to find in the toolbar.

## Version 2 (later)

- Pick tabs as sources (`activeTab` + `tabCapture`). Confirm early that several tabs can be captured at the same time.
- Offscreen document for audio processing.
- WebSocket connection to the server, sending audio and track info.

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
