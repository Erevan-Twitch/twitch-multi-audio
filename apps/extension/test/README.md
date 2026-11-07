# Extension tests

The extension is tested manually for now. Each file in [`cases/`](cases/) is one feature, written so it can be automated later. Each case has:
- an ID, used in commit messages and bug reports
- preconditions
- numbered steps that name the exact controls
- expected results that can be checked

## Setup

1. Build the extension: `pnpm --filter @tma/extension dev` (or `build`).
2. Load it: `chrome://extensions` → **Developer mode** → **Load unpacked** → `apps/extension/dist`. After a rebuild, click the reload icon on the extension's card.
3. Serve the test page: `pnpm --filter @tma/extension test:fixtures`, then open http://localhost:5310/media-page.html.
4. Open the side panel by clicking the extension's toolbar icon.

## Test page

[`fixtures/media-page.html`](fixtures/media-page.html) lets you drive each input the extension reads:
- **Player:** plays a quiet 440 Hz tone, with "Mute in player" buttons.
- **Media Session metadata:** set, change ("Next track") or clear the track info.
- **Declared playbackState:** sets `navigator.mediaSession.playbackState`.
- **`?metadata=1`:** sets track info on load without playing.

The "Current page state" block shows what the page is doing. The artwork has three sizes in different colors: the 512px one is **green**. The panel should always show green, even though it isn't listed last.

The same page on two different sites, for tests that navigate between sites:
- http://localhost:5310/media-page.html
- http://127.0.0.1:5310/media-page.html

## Panel states

| Icon | Meaning |
| --- | --- |
| 🔊 | Playing |
| ⏸ | Paused or silent |
| 🔈 | Playing but muted in the player |
| 🔇 | Muted at the tab level (tooltip says by whom) |

Hover the icon to see the tooltip.

## Cases

- [01: tab list](cases/01-tab-list.md) (roadmap Step 1)
- [02: track info](cases/02-track-info.md) (roadmap Step 2)
