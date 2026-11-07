# Spike: multi-tab capture

Throwaway test on the `spike/tab-capture` branch, before version 2. Code lives in `apps/extension/src/spike/`.

Questions to answer:
1. Can several tabs be captured **at the same time**?
2. Which user actions allow a capture: context menu, keyboard shortcut, side panel button?
3. Can the captured tabs be mixed, switched and crossfaded in an offscreen document?
4. What happens on navigation, on tab close, and to latency?

## Setup

1. `pnpm --filter @tma/extension dev`, then reload the extension in `chrome://extensions`. Chrome may ask to accept new permissions (tab capture, context menus).
2. Check the shortcut at `chrome://extensions/shortcuts`: "Spike: capture this tab's audio" should be **Alt+Shift+C**. If it's empty (a conflict), set it there.
3. Open two tabs playing different audio, e.g. the test page (http://localhost:5310/media-page.html, **Play**) and a YouTube or SoundCloud track.
4. Open the side panel: a "Spike: tab capture" section appears under the tab list, with a log.
5. Optional, for detailed errors: open the offscreen document's console from `chrome://extensions` → the extension's card → "Inspect views: offscreen.html". It appears after the first capture.

## SC-01: Capture from the context menu

1. On tab A, right-click the page → **Spike: capture this tab's audio**.

**Expected:**
- The log shows `✓ capture via context-menu`, with `getCapturedTabs` listing tab A as `active`.
- Tab A appears in the spike's capture list.
- Tab A's audio is still heard: it now plays through the offscreen document.

## SC-02: Capture a second tab at the same time (the main question)

1. On tab B, press **Alt+Shift+C**, or use the context menu.

**Expected:**
- The log shows `✓ capture via shortcut` (or `context-menu`), with `getCapturedTabs` listing **both** tabs as `active`.
- Both tabs are heard at the same time, mixed.

If this fails, write down the exact error from the log.

## SC-03: Capture from the side panel button

1. Stop tab B's capture (**Stop**).
2. Bring tab B to the front without right-clicking it or using the shortcut. Then click **Capture active tab (panel button)**.

**Expected:** this tells whether a panel button can start a capture. Write down `✓` or the `✗ getMediaStreamId failed` error.

## SC-04: Same tab twice

1. With tab A captured, capture tab A again from the context menu.

**Expected:** write down what happens. Probably an error such as "Cannot capture a tab with an active stream".

## SC-05: Volume and source switching

**Preconditions:** tabs A and B captured.

1. Move tab A's slider to 0, then back up.
2. Set the crossfade duration to 0 and click **Crossfade to** on tab B, then on tab A.
3. Set the duration to 3 s and click **Crossfade to** on tab B.

**Expected:**
1. Tab A fades out and back, and tab B is unaffected.
2. A hard switch between the two.
3. A smooth 3 s crossfade with no clicks or dropouts.

## SC-06: Navigation inside a captured tab

1. In a captured tab, open another page or track on the same site, then another site.

**Expected:** write down whether the capture survives. The docs say it does: the log should show no "track ended", and the new page's audio should still be heard through the spike.

## SC-07: Closing a captured tab

1. Close a captured tab.

**Expected:** the log shows `track ended for tab …`, and the tab leaves the capture list.

## SC-08: Latency and quality

1. Capture a YouTube video and watch it.

**Expected:** write down whether the audio is noticeably behind the picture. Also note the latency shown by the spike, and any glitches over a few minutes.

## SC-09: Toolbar icon (optional)

The toolbar icon currently opens the side panel. Test whether that click also grants the capture:
1. On a tab never captured or right-clicked since the extension loaded, click the toolbar icon.
2. Then click **Capture active tab (panel button)**.

**Expected:** write down `✓` or `✗`. Compare with SC-03, where the panel was already open.

## SC-10: Toolbar icon starts the capture, then opens the panel

SC-09 showed that a panel click never grants the capture, even right after the toolbar click. In this variant, the toolbar click captures the tab itself (`action.onClicked`), then opens the panel (`chrome.sidePanel.open`).

**Preconditions:**
- Extension rebuilt and **reloaded**, so the new "don't open the panel on icon click" setting applies.
- Side panel **closed**.
- A tab playing audio, not captured yet.

1. On that tab, click the **Twitch Multi Audio** button in the toolbar.

**Expected:**
- The side panel opens.
- The tab appears in the spike's capture list within ~1 s, and its audio is still heard.

The log line about the capture is sent before the panel finishes loading, so it may be missing from the panel's log. If the tab doesn't appear, check the service worker console (`chrome://extensions` → **service worker**) for `[spike]` lines.

2. With the panel open, go to a second tab playing audio and click the toolbar button again.

**Expected:** the second tab is captured too. The panel stays open.

## Results

| Case | Result | Notes / exact errors |
| --- | --- | --- |
| SC-01 context menu | ✓ | YouTube tab captured, still heard through the offscreen document. |
| SC-02 two tabs at once | ✓ | YouTube + Chillhop captured together, `getCapturedTabs` lists both as `active`, both heard mixed. AudioContext latency: base 5.3 ms, output 16.0 ms. |
| SC-03 panel button | ✗ | `Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured.` A panel click doesn't grant `activeTab`. |
| SC-04 same tab twice | ✓ | Rejected with an error saying the tab is already being shared. Expected: handle it as "already a source". |
| SC-05 volume / crossfade | ✓ | Per-tab gain and crossfades work in the offscreen document. |
| SC-06 navigation | ✓ | Capture survives a new page and the next song. It **also survives navigating to another site** (e.g. Wikipedia): the capture and its fader stay, with no audio. Version 2 needs a rule for this. |
| SC-07 tab close | ✓ | Track ends and the capture is removed. |
| SC-08 latency / quality | ✓ | No noticeable lag behind the video or glitches over a few minutes. |
| SC-09 toolbar icon | ✗ | Same `activeTab` error as SC-03: a toolbar click that opens the side panel doesn't grant the capture to the panel. |
| SC-10 toolbar icon captures | ✓ | `✓ capture via toolbar-icon … getCapturedTabs: …=active`; the panel opens and shows the fader. Capturing a second tab with the panel already open (step 2) not reported. |
