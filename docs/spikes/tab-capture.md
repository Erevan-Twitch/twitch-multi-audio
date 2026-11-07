# Spike: multi-tab capture

Throwaway test run on 2026-11-07, before version 2. The code is kept on the `spike/tab-capture` branch (not to be merged); its test steps are in `apps/extension/test/cases/spike-tab-capture.md` on that branch.

## Setup

- The service worker gets a stream ID with `chrome.tabCapture.getMediaStreamId({ targetTabId })`, then creates an offscreen document (`reasons: ["USER_MEDIA"]`) if none exists.
- The offscreen document turns the ID into a stream (`getUserMedia` with `chromeMediaSource: "tab"`), gives each tab its own `GainNode`, and plays the mix to `AudioContext.destination`.
- The side panel shows the captures, with a gain slider, a crossfade and a stop button for each.

Permissions used: `tabCapture`, `offscreen`, `contextMenus`, plus a `commands` shortcut.

## Results

| Case | Result | Notes |
| --- | --- | --- |
| Context menu starts a capture | ✓ | The captured tab is still heard through the offscreen document. |
| **Two tabs captured at once** | ✓ | YouTube and Chillhop together; `getCapturedTabs()` lists both as `active`; both heard mixed. |
| Side panel button starts a capture | ✗ | `Extension has not been invoked for the current page (see activeTab permission).` A panel click doesn't grant `activeTab`. |
| Same tab captured twice | ✓ (rejected) | Chrome refuses: the tab is already being shared. |
| Per-tab volume and crossfade | ✓ | `GainNode` per tab; linear ramps give clean crossfades. |
| Navigation, same site (next song, new page) | ✓ | The capture keeps going. |
| Navigation to another site | ⚠ | The capture **also** keeps going (e.g. on Wikipedia, with no audio). |
| Tab closed | ✓ | The track ends and the capture is removed. |
| Latency and quality | ✓ | No noticeable lag behind the video, no glitches over a few minutes. AudioContext latency: base 5.3 ms, output 16 ms. |
| Toolbar click that opens the panel, then panel button | ✗ | Same `activeTab` error: opening the panel doesn't grant the capture to the panel. |
| **Toolbar click starts the capture itself** | ✓ | With `openPanelOnActionClick: false`, `action.onClicked` captures the tab, then `chrome.sidePanel.open()` opens the panel. |

Not checked: the keyboard shortcut (expected to work like the context menu); capturing a second tab from the toolbar while the panel is already open.

## Conclusions for version 2

- **Option A works:** several tabs can be captured at once and mixed in one offscreen document.
- **A capture must start from something Chrome counts as invoking the extension on that tab:** the toolbar button (handling `action.onClicked` itself, then opening the panel), the context menu, or a keyboard shortcut. **Never from the side panel**: the panel only controls captures that already exist.
- **The extension must stop a capture itself when the tab moves to another site,** consistent with the tab list's rule.
- **Adding a tab that's already a source** must be handled as "already a source", not shown as an error.
