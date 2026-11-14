# Spike: mix on the local server, output to OBS

Throwaway test run on 2026-11-14, before version 2 (test B). The code is on the `spike/server-mix` branch (not to be merged). The test steps and the full results are in [apps/extension/test/cases/spike-server-mix.md](https://github.com/Erevan-Twitch/twitch-multi-audio/blob/spike/server-mix/apps/extension/test/cases/spike-server-mix.md) (rounds 1 to 3).

## Question

Where does the mix happen, and how does it reach OBS? Desktop apps (Spotify, VLC) will be sources later, captured by native code outside Chrome. So the test was the **local server as the mixer**, not the extension's offscreen document.

## Setup

```
tab ─tabCapture─▶ offscreen document ─AudioWorklet─▶ 10 ms Int16 blocks ─WebSocket─▶ server
                                                                                       │ jitter buffer per tab
                                                                                       │ mixer: gain, crossfade
                                                                                       ▼
                                                        audify (RtAudio) ─▶ BlackHole 2ch ─▶ OBS
side panel ─requests (gain, crossfade, stop)─▶ server ─state every second─▶ side panel
```

- **Extension:**
  - The offscreen document no longer plays anything.
  - Each captured tab goes through an AudioWorklet that sends 10 ms blocks of 48 kHz stereo Int16 to `ws://127.0.0.1:7531`.
  - Each block has a 20-byte header: tab ID, sequence number, frame count, capture time.
- **Server (Node 24):**
  - A jitter buffer per tab, and a mixer with sample-accurate linear ramps.
  - Output through `audify` (RtAudio bindings), with `ffmpeg -f audiotoolbox` as a fallback.
- **Control:**
  - The server owns the state: sources, gains, the active source, crossfades.
  - The side panel and a stdin console send requests.
  - The server sends `capture:stop` to the extension when it decides to stop a source.

## Results

| Area | Result | Notes |
| --- | --- | --- |
| Audio path to OBS | ✓ | OBS Audio Input Capture on BlackHole 2ch. The tab is silent in Chrome. |
| Two tabs mixed | ✓ | A new source starts at gain 0 when another one is playing. |
| Gain and crossfade | ✓ | Smooth. Round 1 lost some panel clicks because rows were rebuilt every second; rows are now updated in place. |
| **Server as the control center** | ✓ | Changes made from the server console are heard, and the panel follows them. `stop` ends the tab's capture in Chrome. |
| Moving to another site | ✓ | The extension reports it, the server decides to stop the capture. Same-site navigation (next song) keeps it. |
| Panel closed, server restarted, Chrome closed | ✓ | The mix keeps going without the panel. Clients reconnect after a restart. The server outputs silence when Chrome closes. |
| Glitches | ✓ with a bigger output queue | 91 underruns in 5 min with 20 ms queued for the device. None with 50 ms (`TMA_OUTPUT_QUEUE_BLOCKS=5`). Node's output render gaps reach 40–65 ms. |
| Clock drift | ✓ none seen | Buffer fill steady over 30 min (80 ms jitter target, 50 ms queue). |
| CPU | ✓ | Server about 5 %, extension about 6–7 %. |
| Streamer's monitoring | ✓ | OBS "Monitor and Output" works. The server's second output (`TMA_MONITOR_DEVICE`) works once audify warnings stop being treated as fatal. |
| **Delay** | ✓ for music | About 163 ms from the page to BlackHole (see below). A YouTube video's picture looked about 0.5 s ahead of the sound (eyeball estimate). |

### Delay breakdown (round 3)

A test page plays a click every 2 s and tells the server when it played it. The server finds the same click at each stage. In ms, as the median over 19 clicks, with a 40 ms jitter target and a 50 ms output queue:

| Stage | Through BlackHole | Straight to the headphones |
| --- | --- | --- |
| Chrome capture (page → worklet) | 42 | 42 |
| To the server (includes filling the 10 ms block) | 5–10 | 5–10 |
| Jitter buffer and mix | 40–46 | 39–45 |
| Output queue and device | about 70 (upper bound: includes the loopback recorder's buffering) | not measured |
| **Total** | **about 163** | about 91 before the output |

The click sounded "slightly behind" the page's flash, which agrees with the measurement. Going straight to the headphones was slightly less late. OBS adds no noticeable delay of its own: round 2 heard the same delay with and without OBS.

**The 0.5 s seen with YouTube isn't explained.** No stage comes near it with Web Audio clicks. It was an estimate by eye against a `<video>` element, a different playback path in Chrome. It isn't investigated further: only the music goes on stream, not the tab's picture.

## Conclusions for version 2

- **The local server is the mixer**, and it works: path, mixing, crossfades and control are all fine. Desktop sources can join the same mixer later.
- **The server is the only control center.** Controllers (panel now, Stream Deck and web UI later) send requests, and the server decides and broadcasts its state. The extension starts captures (Chrome needs a user gesture on the tab), reports events, and carries out `capture:stop`.
- **Buffer settings:**
  - Start with a 40 ms jitter target and a 50 ms output queue (about 160 ms end to end, no glitches).
  - The 80 ms jitter target gave no extra benefit in these tests.
  - Make both configurable.
- **Delay against the tab's video is a known limit,** not a goal: the tab's picture isn't streamed. If it ever is, OBS's Sync Offset on the video source can compensate.
- **Drift correction isn't needed** for the first version (none in 30 min). Keep the buffer-fill log to catch it on longer streams.
- **Things to add in version 2:**
  - An output underrun counter. The current `underruns` counts the jitter buffer's only. Node's worst render gap (61.6 ms) exceeded the 50 ms queue without an audible glitch, so the device's own buffer probably covered it.
  - A real protocol in `@tma/shared` instead of the spike's copied file.
- **Output backend:** audify works on Node 24 (macOS arm64) once its warnings are only logged. The ffmpeg fallback also works. A native sidecar isn't needed yet; it may come back with desktop capture (Core Audio process taps).
- **macOS audio permission:** a server started from a terminal needs that app to be allowed to use audio devices. Until the prompt is answered, opening BlackHole hangs without an error. Version 2 should time out and report it.
