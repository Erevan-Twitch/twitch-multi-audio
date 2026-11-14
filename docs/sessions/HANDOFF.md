# Handoff: resuming work

Read this first in a new Claude Code session. Last updated 2026-11-07. Also read [docs/roadmap.md](../roadmap.md) (the plan and its decisions) and [the last session recap](2026-11-07-recap.md).

## Project in one paragraph

A tool for a Twitch stream: aggregate several audio sources into one output captured by OBS, choose which source plays (later with crossfades and per-source volume), and show the current title, artist and cover on stream. Sources are browser tabs, through a Chrome extension. Desktop apps like Spotify come later, captured at the OS level. Control through a Stream Deck and possibly a web UI comes after that.

## Where things stand

- **Version 1 (extension lists tabs with track info): done.**
- **Version 2, test A (several tabs captured at once): done, it works.** See [docs/spikes/tab-capture.md](../spikes/tab-capture.md).
- **Next: version 2, test B.** Not started; see below.

### Git

| Branch | State |
| --- | --- |
| `main` | Bootstrap commit only. |
| `feat/list-tabs-with-audio` | All the work so far. Last commit `5677907`, **not pushed**. No PR yet: ask the user whether to push, open a PR and merge into `main` before starting version 2. |
| `spike/tab-capture` | Throwaway test code, pushed. **Never merge.** Read it as a reference for `tabCapture` and offscreen code. |

## Next task: test B (where the mix happens and how it reaches OBS)

Roadmap section "Test B". Recommended first test, agreed but not yet decided:
- **Mix in the extension:** in the offscreen document, as in test A, where mixing and crossfades already work.
- **Output to a virtual device:** send the mix to a virtual audio device with `AudioContext.setSinkId(deviceId)`, e.g. BlackHole 2ch on macOS.
- **Capture in OBS:** OBS captures that device with an audio input source.
- **The server's role:** selection, track info, Stream Deck and overlay.

Alternatives to keep in mind:
- Mix on the server and write to the virtual device from Node: native module, raw audio over the WebSocket.
- Mix in an OBS Browser Source page.

Do this as a **spike on its own branch** from the up-to-date branch, like `spike/tab-capture`:
- code in `apps/extension/src/spike/`
- every line touched outside it marked `SPIKE (throwaway)`
- the test steps and a results table in `apps/extension/test/cases/`

Risks to check first:
- **Choosing the output device:** `navigator.mediaDevices.enumerateDevices()` may return empty labels without microphone permission, and an offscreen document can't show a permission prompt. A visible extension page, like the side panel or a tab, may have to request permission first, or pick the device.
- **Is `setSinkId` there?** Confirm `setSinkId` exists on `AudioContext` in an offscreen document (Chrome 110+).
- **Echo and duplicates:** the streamer's own monitoring. Captured tabs are silent locally, and the mix plays only where `setSinkId` sends it.

The user installs BlackHole and configures OBS themselves; write those steps in the test case file.

## Rules for working with this user

- **Never run automated browser tests** (Puppeteer, Playwright, Chrome for Testing). The user tests manually. After a change, run `pnpm typecheck` and `pnpm build`. Then write or update the test cases in `apps/extension/test/cases/`: preconditions, numbered steps, results that can be checked, written so they can be automated later. Point the user to them.
- **Commit, push or open PRs only when asked.** "Do the commit and nothing else" means exactly that. Conventional commit messages, e.g. `feat(extension): …`, `fix(extension): …`, `docs: …`, `spike(extension): …`.
- **No extension framework** (no WXT or Plasmo): plain Chrome APIs. esbuild only bundles.
- **Stack:** TypeScript (7.x), pnpm (12.x, through Corepack), Turbo. Node 24.
- **When the user says "don't write code",** answer with explanations and documentation only.
- **When something is unknown,** give the user precise checks to run (DevTools console snippets, the service worker console) and decide from their output instead of guessing. That's how the Chillhop issues were solved.
- **The user edits the roadmap and test files too.** Re-read them before changing them.

## Code map (`apps/extension`)

| Path | Role |
| --- | --- |
| `public/manifest.json` | MV3 manifest: permissions `sidePanel tabs activeTab storage scripting`, host permissions for all http/https pages, two content scripts. |
| `src/background/service-worker.ts` | Identification rule, one record per tab in `storage.local` (`tabRecords`), panel port broadcasts, injection on `onInstalled`. |
| `src/content/media-session.ts` | Isolated-world content script: checks the page every second, reports `MediaState`. |
| `src/content/page-hook.ts` + `page-bridge.ts` | Page-context `play()` hook for players kept out of the page; DOM event exchange with the content script. |
| `src/sidepanel/*` | The panel UI. |
| `src/messages.ts` | Extension-internal message types (`TabEntry`, `MediaState`, …). |
| `scripts/build.ts` | esbuild: ESM for the service worker and panel, IIFE for content scripts; copies `public/` and the HTML/CSS. |
| `scripts/serve-fixtures.ts` | Serves the test page on `localhost:5310` and `127.0.0.1:5310`, which count as two sites. |
| `test/` | Manual test docs and the test page. |

Shared protocol drafts are in `packages/shared/src/protocol.ts`. `apps/server/src/index.ts` is a WebSocket skeleton on 127.0.0.1:7531.

## Facts learned the hard way

- **`Tab.audible`:** "sound in the last ~2 s". It stays `true` when muted at the tab level, and when a player is set to `volume = 0`. It turns `false` when paused or when the element is `muted`.
- **`storage.session`** is wiped on extension reload. Tab IDs only last one browser session.
- **Manifest content scripts** don't run in tabs that were already open at install, update or reload.
- **A content script in the isolated world can read `navigator.mediaSession.metadata`.**
- **Starting a capture:** `tabCapture.getMediaStreamId()` needs the `activeTab` grant. A side panel click doesn't give it, and neither does a toolbar click while `openPanelOnActionClick` is true. To make the toolbar button capture, set `openPanelOnActionClick: false`, capture in `action.onClicked`, then call `chrome.sidePanel.open()` immediately to keep the user gesture.
- **A capture survives navigating to another site.** The extension must stop it itself (version 2 rule).

## Open items

- **No extension icon yet:** the roadmap ticks it, but no icon file exists.
- **Untested trigger:** the keyboard shortcut as a capture trigger.
- **Later:** Spotify desktop as a source (OS-level capture, e.g. Core Audio process taps or ScreenCaptureKit on macOS 14.2+), Stream Deck, web UI, on-stream overlay.
