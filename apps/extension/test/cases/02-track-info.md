# 02: Track info

Roadmap Step 2: the content script reads the page's Media Session info and media elements, and the panel shows cover, title, artist and state.

Unless stated, each case starts from: extension freshly reloaded, side panel open, test page open at http://localhost:5310/media-page.html.

The content script checks the page every second, so allow up to 2 s for any change to reach the panel.

## TI-01: Track info of a playing tab (answers the isolated-world question)

1. Click **Set metadata**, then **Play**.

**Expected:**
- The entry shows title **Test Track 1** and artist **Test Artist**.
- The cover is a **green** square (the largest artwork), not red or blue.
- The state is 🔊, and the site line shows `localhost`.

If title, artist and cover never appear while TL-01 works, the content script can't read `navigator.mediaSession.metadata` from its isolated context. Report it: track info will have to be read in the page's own context (`world: "MAIN"`).

## TI-02: A paused tab with track info joins without playing

1. Open http://localhost:5310/media-page.html?metadata=1 in a new tab. Don't play.

**Expected:** within 2 s, the tab is listed with the track info and ⏸.

## TI-03: Track change

**Preconditions:** TI-01 done.

1. Click **Next track**.

**Expected:** the title becomes **Test Track 2** within 2 s; the entry doesn't disappear or flicker.

## TI-04: Muted in the player

**Preconditions:** TI-01 done (playing).

1. Click **Mute in player**.
2. Hover the panel's state icon.

**Expected:** the state becomes 🔈 and the tooltip says "Muted in the player". The tab stays listed.

**Then:**

3. Click **Unmute in player**.

**Expected:** the state goes back to 🔊.

## TI-05: Tab-level mute takes priority over the player state

**Preconditions:** TI-01 done (playing).

1. Mute the tab at the tab level (tab strip → **Mute site**).

**Expected:** state 🔇, tooltip "Muted (tab)".

**Clean up:** unmute the tab.

## TI-06: A short gap between tracks doesn't remove the tab

**Preconditions:** TI-01 done, then **Pause** clicked.

1. Click **Clear metadata**.
2. Within 5 s, click **Next track**.

**Expected:** the entry never disappears. It keeps showing the previous track until the new one appears.

## TI-07: Clearing track info on a silent tab removes it

**Preconditions:** TI-01 done, then **Pause** clicked.

1. Click **Clear metadata**.
2. Wait 12 s.

**Expected:** the entry still shows the previous track for about 10 s, then disappears.

## TI-08: Clearing track info while playing keeps the tab until it's silent

**Preconditions:** TI-01 done (playing).

1. Click **Clear metadata** and wait 12 s.

**Expected:** still listed with 🔊, showing the tab title and "No track info".

2. Click **Pause**.

**Expected:** within 5 s, the entry disappears. Chrome keeps a tab "audible" for a couple of seconds after the sound stops.

## TI-09: Page without track info

1. Open the test page in a new tab, click **Play** without setting metadata.

**Expected:**
- Listed with 🔊.
- Title is the tab's title (**TMA test player**), with "No track info" in italics.
- The favicon area, or an empty square, stands in for the cover.

## TI-10: Declared playbackState wins over the media elements

1. Click **Set metadata**. Don't play.
2. Click declared playbackState **playing**.

**Expected:** state 🔊 even though no sound plays, because the page declares it's playing.

3. Click declared **none**.

**Expected:** back to ⏸, derived from the paused `<audio>` element.

## TI-11: Tabs open before install are picked up

**Preconditions:** test page open with `?metadata=1` and **not playing**.

1. In `chrome://extensions`, **Remove** the extension, then **Load unpacked** again. This is a fresh install with empty storage.
2. Open the side panel.

**Expected:** the tab is listed with its track info. This shows the content script was injected into the already-open tab.

## TI-12: Old content scripts stop after a reload

**Preconditions:** test page playing with metadata, page DevTools console open.

1. Reload the extension, then wait 5 s.

**Expected:**
- No repeated "Extension context invalidated" errors in the page console.
- The panel still shows the tab, with track info updates working (click **Next track**).

## TI-14: A decorative background video doesn't count as the player

1. Open http://localhost:5310/media-page.html?bgvideo=1&metadata=1. The color-cycling video at the top is the background video.
2. Click **Play**.

**Expected:** state 🔊. Not 🔈, even though the background video is muted.

3. Click **Mute in player**.

**Expected:** state 🔈 within 2 s, tooltip "Muted in the player".

## TI-15: Player kept out of the page (like Chillhop)

The page-context hook catches elements that call `play()`, even ones not in the page.

1. Open http://localhost:5310/media-page.html?detached=1&bgvideo=1&metadata=1. The page state shows `"playerInPage": false`.
2. Click **Play**.

**Expected:** state 🔊.

3. Click **Volume 0 in player**. This is how Chillhop mutes. Chrome's tab speaker icon stays on.

**Expected:** within 2 s, state 🔈, tooltip "Muted in the player".

4. Click **Restore volume**, then **Mute in player**.

**Expected:** 🔊, then 🔈 again with the same tooltip.

5. Click **Unmute in player**, then **Pause**.

**Expected:** 🔊, then ⏸.

## TI-16: Volume 0 on a player in the page

1. Open http://localhost:5310/media-page.html?metadata=1 and click **Play**.
2. Click **Volume 0 in player**.

**Expected:** within 2 s, state 🔈, tooltip "Muted in the player".

## TI-17: Hook added to tabs open before install

**Preconditions:** test page at `?detached=1&metadata=1` open and **playing**, before the extension is installed.

1. Install the extension (**Load unpacked**).
2. Click **Volume 0 in player**.

**Expected:** no 🔈 yet. The hook was added after the player's `play()` call, so it hasn't seen it.

3. Click **Pause**, **Play**, then wait 2 s.

**Expected:** state 🔈. The new `play()` call was caught.

## TI-13: Real sites

For each site used on stream, play a track and fill in the table. Use "partial" when, for example, the cover is missing.

| Site | Title | Artist | Cover | Paused state | Player mute detected | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| YouTube | yes | yes | yes | | | TI-01 passed |
| YouTube Music | yes | yes | yes | yes | yes | |
| Spotify Web | | | | | | |
| SoundCloud | yes | yes | yes | yes | yes | TI-01 passed |
| Chillhop | yes | yes | yes | yes | no → retest | TI-01 passed. Plays through an `<audio>` kept out of the page and "mutes" with `volume = 0`, which Chrome still reports as audible. It also has a muted background video. Covered by TI-14 and TI-15. |
| Deezer | | | | | | |

Known limitations:
- **Players kept out of the page** are seen by the page-context hook only from their next `play()` call (TI-17).
- **Pure Web Audio players** (no media element at all) can't be checked. Player mute is then guessed: the page says it's playing, but Chrome reports the tab silent for 3 s. Chrome keeps a tab "audible" when it's muted through volume rather than `muted`, so this guess may often miss. The test page can't reproduce it.
