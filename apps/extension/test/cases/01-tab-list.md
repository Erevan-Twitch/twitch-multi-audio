# 01: Tab list

Roadmap Step 1: which tabs are listed, and when they leave the list. See "How tabs are identified" in [docs/roadmap.md](../../../../docs/roadmap.md).

Unless stated, each case starts from: extension freshly reloaded, side panel open, no other tab playing audio. Times are upper bounds; updates usually arrive within a second.

## TL-01: A playing tab joins the list

**Preconditions:** test page open, nothing played yet.

1. Click **Play**.

**Expected:** within 2 s, the tab appears in the panel with 🔊.

## TL-02: A paused tab stays in the list

**Preconditions:** TL-01 done (tab listed and playing).

1. Click **Pause**.
2. Wait 5 s.

**Expected:** the tab is still listed, now with ⏸.

## TL-03: Tab-level mute keeps the tab and shows who muted it

**Preconditions:** test page playing and listed.

1. Right-click the tab in Chrome's tab strip → **Mute site**. Or click the speaker icon on the tab.
2. Hover the panel's icon.

**Expected:** the tab stays listed with 🔇; the tooltip says "Muted (tab)".

**Clean up:** unmute the tab.

## TL-04: A muted, never-played tab joins the list

**Preconditions:** test page open, nothing played, tab not listed.

1. Mute the tab at the tab level (as in TL-03).

**Expected:** the tab appears with 🔇.

## TL-05: Closing a tab removes it

**Preconditions:** test page listed.

1. Close the tab.

**Expected:** the entry disappears within 2 s.

## TL-06: Navigating to another site removes it

**Preconditions:** test page at `localhost` listed and **paused**, with **no** metadata set.

1. In the same tab, open http://127.0.0.1:5310/media-page.html.

**Expected:** the entry disappears within 2 s, and the new page isn't listed until it plays.

## TL-07: Several tabs

**Preconditions:** none.

1. Open the test page in 3 tabs.
2. Play tabs 1 and 2, then pause tab 1.
3. Leave tab 3 untouched.

**Expected:** tab 1 listed with ⏸, tab 2 listed with 🔊, tab 3 not listed. The tab in front is highlighted.

## TL-08: The list survives an extension reload

**Preconditions:** two tabs listed, one playing and one paused.

1. Reload the extension in `chrome://extensions`.
2. Reopen the side panel.

**Expected:** both tabs are still listed with their state.

## TL-09: The list survives the service worker stopping

**Preconditions:** one tab listed and paused.

1. In `chrome://extensions`, open the extension's **service worker** inspector. Its "Application" tab or `chrome://serviceworker-internals` lets you **Stop** it. Or close the inspector and wait more than 30 s idle.
2. Interact with the side panel or any tab.

**Expected:** the panel reconnects on its own and still shows the paused tab.

## TL-10: The panel reflects changes made while it was closed

**Preconditions:** side panel closed.

1. Play a tab for 3 s, then pause it.
2. Open the side panel.

**Expected:** the tab is listed with ⏸.

## TL-11: Browser restart clears the list

**Preconditions:** one tab listed and paused.

1. Quit Chrome completely and reopen it, restoring tabs.
2. Open the side panel.

**Expected:** stale entries are gone; only restored tabs that have a signal are listed (playing, muted, or publishing track info; see 02).
