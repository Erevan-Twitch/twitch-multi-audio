# Handoff: resuming work

Read this first in a new Claude Code session. Last updated 2026-11-14. Also read [docs/roadmap.md](../roadmap.md) (the plan and its decisions) and [the last session recap](2026-11-07-recap.md).

## Project in one paragraph

A tool for a Twitch stream: aggregate several audio sources into one output captured by OBS, choose which source plays (later with crossfades and per-source volume), and show the current title, artist and cover on stream. Sources are browser tabs, through a Chrome extension. Desktop apps like Spotify come later, captured at the OS level. Control through a Stream Deck and possibly a web UI comes after that.

## Where things stand

- **Version 1 (extension lists tabs with track info): done.**
- **Version 2, test A (several tabs captured at once): done, it works.** See [docs/spikes/tab-capture.md](../spikes/tab-capture.md).
- **Version 2, test B (mix on the server, output to BlackHole for OBS): done, it works.** See [docs/spikes/server-mix.md](../spikes/server-mix.md). The roadmap's test B and "Then" sections are updated.
- **Next: plan the version 2 implementation** from the roadmap's "Then" list, on a new branch from `main`. Nothing from the spike branches is merged; reuse their code by copying it deliberately.

### Git

| Branch | State |
| --- | --- |
| `main` | Version 1 merged (PR #1, `77bba35`). |
| `spike/server-mix` | Test B, from `main`, with test A's code on top. Committed locally (`c77a626` spike code, then a `docs:` commit), not pushed. **Never merge**; the docs commit is worth bringing to `main`. |
| `spike/tab-capture` | Test A code, pushed. **Never merge.** |

## Decisions made on 2026-11-14 (now in the roadmap's test B section)

- **The local server is the mixer**, not the extension, because desktop apps (Spotify, VLC) will be captured by native code outside Chrome. The extension streams each captured tab's raw PCM over the WebSocket; the server mixes and writes to the virtual device (BlackHole 2ch) that OBS captures. This replaces the `setSinkId` idea from the previous handoff.
- **The server is the only control center.** It owns sources, gains, the active source and crossfades. Controllers send requests; the server decides and broadcasts its state. Controllers: side panel now, Stream Deck and web UI later. The extension carries out the server's commands (`capture:stop`) and reports events (`source:added`, `source:ended`, `source:navigated-away`). It has no audio controls.
- **The server can't start a tab capture:** Chrome needs a user gesture on the tab (toolbar, context menu, shortcut). The extension starts it and announces it; from then on the server owns it.

## Architecture diagrams

[docs/architecture/](../architecture/README.md) holds the architecture as code (LikeC4): the target model, the test B spike, flows and deployment. Open it with `pnpm arch`. Keep `model.c4` in line with decisions; the user installed `likec4` at the root, and its DSL skill is in `.claude/skills/likec4-dsl`.

## Test B: how it went (done)

- **Round 1:** the audio path, mixing and server control worked. Problems: glitches, the monitor output going silent (an audify warning treated as fatal), panel clicks lost.
- **Round 2:** fixes confirmed. A 50 ms output queue (`TMA_OUTPUT_QUEUE_BLOCKS=5`) removed the glitches. No drift in 30 min. CPU: server about 5 %, extension about 6–7 %.
- **Round 3:** the click probe measured about 163 ms from the page to BlackHole. The user heard the click "slightly behind", which agrees. The 0.5 s seen against a YouTube video's picture isn't explained. The user decided it doesn't matter: only the music goes on stream, not the tab's picture.
- **Version 2 settings:** 40 ms jitter target, 50 ms output queue, both configurable. Add an output underrun counter (Node's worst render gap, 61.6 ms, exceeded the queue without an audible glitch).

Test steps and results (in each case's Got section): [apps/extension/test/cases/spike-server-mix.md](../../apps/extension/test/cases/spike-server-mix.md).

What exists on `spike/server-mix`:
- **Extension** (`apps/extension/src/spike/`):
  - `pcm-tap.worklet.ts`: 10 ms Int16 stereo blocks.
  - `offscreen.ts`: WebSocket role `capture`, binary frames with a 20-byte header (tabId, seq, frames, f64 capture time in epoch ms), reconnects.
  - `panel.ts`: role `control`, renders the server's state and sends requests.
  - `service-worker.ts`: capture triggers; reports moves to another site.
  - `server-protocol.ts`: a copy of the server's spike protocol.
- **Server** (`apps/server/src/spike/`), run with `pnpm --filter @tma/server spike`:
  - jitter buffer per source (40 ms target)
  - mixer with sample-accurate ramps
  - output through `audify` if installed, else `ffmpeg -f audiotoolbox`
  - stdin console (`list`, `gain`, `fade`, `stop`, `devices`)
  - `[drift]` log every 5 s
  - env: `TMA_OUTPUT_DEVICE`, `TMA_MONITOR_DEVICE`, `TMA_OUTPUT_BACKEND`, `TMA_JITTER_MS` (default 40), `TMA_OUTPUT_QUEUE_BLOCKS` (default 2; 5 removes the glitches), `TMA_PROBE=1` (BlackHole loopback for the delay probe)
  - `probe.ts`: per-stage delay of the click page's clicks (`[latency]` lines)

Checked by Claude: typecheck, build, and Node-only runs with fake WebSocket clients (control flow, `capture:stop`, ffmpeg and audify output, the delay probe). The user installed BlackHole and `audify`, set up OBS, and ran rounds 1–3 in Chrome.

Open for version 2: audify vs ffmpeg vs a native sidecar (audify works; a sidecar may come back with desktop capture).

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

Shared protocol drafts are in `packages/shared/src/protocol.ts`. `apps/server/src/index.ts` is a WebSocket skeleton on 127.0.0.1:7531. The test B spike server (`pnpm --filter @tma/server spike`) uses the same port, so don't run both.

## Facts learned the hard way

- **`Tab.audible`:** "sound in the last ~2 s". It stays `true` when muted at the tab level, and when a player is set to `volume = 0`. It turns `false` when paused or when the element is `muted`.
- **`storage.session`** is wiped on extension reload. Tab IDs only last one browser session.
- **Manifest content scripts** don't run in tabs that were already open at install, update or reload.
- **A content script in the isolated world can read `navigator.mediaSession.metadata`.**
- **Starting a capture:** `tabCapture.getMediaStreamId()` needs the `activeTab` grant. A side panel click doesn't give it, and neither does a toolbar click while `openPanelOnActionClick` is true. To make the toolbar button capture, set `openPanelOnActionClick: false`, capture in `action.onClicked`, then call `chrome.sidePanel.open()` immediately to keep the user gesture.
- **A capture survives navigating to another site.** The extension must stop it itself (version 2 rule).
- **macOS audio permission blocks without an error.** A process started from VS Code's terminal (the server, or Claude's commands) needs VS Code to be allowed to use audio devices. Until the macOS prompt is answered, opening a device with inputs (BlackHole) just hangs, in audify and in ffmpeg. Devices with no inputs, like the speakers, open fine.

## Open items

- **No extension icon yet:** the roadmap ticks it, but no icon file exists.
- **Untested trigger:** the keyboard shortcut as a capture trigger.
- **Later:** Spotify desktop as a source (OS-level capture, e.g. Core Audio process taps or ScreenCaptureKit on macOS 14.2+), Stream Deck, web UI, on-stream overlay.
