# Spike: mix on the server, output to a virtual device for OBS (test B)

Throwaway test on the `spike/server-mix` branch. Extension code: `apps/extension/src/spike/`. Server code: `apps/server/src/spike/`. `spike-tab-capture.md` is test A's record; its steps don't match this branch's UI anymore.

Questions to answer:
1. Can the extension stream each captured tab's audio to the local server, and the server mix it and write it to BlackHole for OBS?
2. Is the server the single control center? Gain, crossfade and stop are decided there, from the panel or from the server console, and the extension follows.
3. What does it cost: delay against the video, glitches, clock drift over a long session, CPU?

How it works:
- The offscreen document no longer plays anything. Each captured tab goes through an AudioWorklet that sends 10 ms blocks of 48 kHz stereo audio to `ws://127.0.0.1:7531`.
- The server keeps a jitter buffer per tab (40 ms target), mixes, and writes to the output device.
- The side panel is a remote control: it shows the server's state and sends it requests.

## Setup (once)

1. **Install BlackHole 2ch:** `brew install blackhole-2ch`, or the installer from https://existential.audio/blackhole/. Restart the Mac if it doesn't show up in **System Settings → Sound → Output**. Don't select it as the system output.
2. **Check that macOS sees it:** run `ffmpeg -hide_banner -f lavfi -i anullsrc -t 0 -f audiotoolbox -list_devices true -`. **BlackHole 2ch** should appear in the list.
3. **Output backend (optional but recommended):** install audify. It writes to the device from inside the server, paced by the device's clock:
   ```
   pnpm --filter @tma/server add audify
   ```
   - If pnpm says audify's build scripts were ignored, approve them (`pnpm approve-builds`) and install again.
   - If the server prints `audify is installed but failed to load: …`, write down the message.
   - Without audify, the server pipes the audio to `ffmpeg` instead: no install needed, but the delay is higher. To force ffmpeg even with audify installed, start the server with `TMA_OUTPUT_BACKEND=ffmpeg`.
   - Write down which backend you used. The server prints it at start-up (`[output] playing to "BlackHole 2ch" with audify|ffmpeg`).
4. **OBS:**
   1. Settings → Audio → Sample Rate: **48 kHz**. Monitoring Device: your headphones.
   2. Sources → **+** → **Audio Input Capture** → name it "Tab mix" → Device: **BlackHole 2ch**.
   3. Edit → Advanced Audio Properties → "Tab mix" → Audio Monitoring: **Monitor and Output**. That's how you hear the mix in SM-03 to SM-10; SM-11 compares it with another option.
5. **Extension:** `pnpm --filter @tma/extension dev`, then reload it in `chrome://extensions`. Close and reopen any tab you want to capture, so the new context menu entry is there.
6. **Server:** in a terminal, `pnpm --filter @tma/server spike`. Leave it open: the console and the `[drift]` lines are in there.

Useful places:
- **Side panel:** the "Spike: server mix" section, with the connection, the output device, one row per source with its stats, and a log.
- **Server terminal:** type `list`, `gain <tabId> <0-1>`, `fade <tabId> <seconds>`, `stop <tabId>`, `devices`.
- **Offscreen console:** `chrome://extensions` → the extension → "Inspect views: offscreen.html". It appears after the first capture. Every 5 s it prints a `[spike] socket open, bufferedAmount …` line.

## SM-01: The server opens BlackHole

1. Start the server (setup step 6).

**Expected:**
- `[output] … devices:` lists **BlackHole 2ch**.
- Then `[output] playing to "BlackHole 2ch" with audify` (or `ffmpeg`).
- Then `[server] spike listening on ws://127.0.0.1:7531`.

If you see `✗ no output device matching …` instead, write down the device list it printed.

**Got:**
```
pnpm --filter @tma/server spike

$ tsx src/spike/main.ts
[output] audify devices: [129] IVM: PL2875UH, [130] Blue Microphones: Yeti X, [132] Existential Audio Inc.: BlackHole 2ch, [134] Apple Inc.: External Headphones, [136] Apple Inc.: MacBook Pro Speakers
[output] playing to "Existential Audio Inc.: BlackHole 2ch" with audify
[console] commands: list | gain <tabId> <0-1> | fade <tabId> <seconds> | stop <tabId> | devices
[server] spike listening on ws://127.0.0.1:7531
[output] audify error: RtApiCore::closeStream(): no open stream to close!
[output] audify error: RtApiCore::closeStream(): no open stream to close!
```


## SM-02: The panel connects to the server

1. Open the side panel.

**Expected:**
- The panel shows `Connected to ws://127.0.0.1:7531`, then `Output: ✓ "BlackHole 2ch" via …`, and `Extension capture client: not connected` (no capture yet).
- The server prints `control client connected`.

**Got:**
```
4:01:40 PM server: control client connected
4:01:40 PM offscreen: connected to ws://127.0.0.1:7531
4:01:40 PM offscreen: AudioContext at 48000 Hz
```

## SM-03: One tab heard in OBS

1. On a tab playing music, click the extension's toolbar button, or right-click → **Spike: send this tab's audio to the server**.

**Expected:**
- The tab is **silent in Chrome**: it's captured, and the extension doesn't play it.
- Server: `capture client connected`, then `source added: tab <id> "…"`.
- Panel: a row with `▶`, gain 1.00, and a buffer around **40 ms** (not "filling").
- OBS: the "Tab mix" meter moves, and the music is heard through OBS monitoring.

**Got:**
```  
[server] capture client connected
[server] control client connected
[server] source added: tab 1056616695 "Cartoon, Jéja - On & On (feat. Daniel Levi) | Electronic Pop | NCS - Copyright Free Music - YouTube (www.youtube.com)"
[drift] tab 1056616695: buffer 30.0 ms, underruns 0, overflow 0 frames, seq gaps 0
[drift] tab 1056616695: buffer 30.0 ms, underruns 0, overflow 0 frames, seq gaps 0
[drift] tab 1056616695: buffer 30.0 ms, underruns 0, overflow 0 frames, seq gaps 0
[drift] tab 1056616695: buffer 30.0 ms, underruns 0, overflow 0 frames, seq gaps 0
[drift] tab 1056616695: buffer 30.0 ms, underruns 0, overflow 0 frames, seq gaps 0
[server] source added: tab 1056616696 "Livestream - Chillhop Music (app.chillhop.com)"
```
- Tab Mix meter moves

## SM-04: Two tabs mixed

1. Capture a second tab playing different audio.

**Expected:**
- A second row appears at **gain 0.00**: a new source starts silent when another one is already playing.
- Move its slider up: the OBS meter shows both tabs mixed.

**Got:**
- Second row appears at gain 0
- OBS meter and monitoring does plays both tabs mixed

## SM-05: Crossfade and gain from the panel

**Preconditions:** two sources (SM-04).

1. Set the duration to 3 s, then click **Crossfade to** on the silent source.
2. Move one slider down to 0, then back up.

**Expected:**
1. A smooth 3 s crossfade in OBS, with no clicks. The panel shows `gain x → y` during the ramp, and `▶` moves to the new source.
2. The volume follows the slider; the server prints `gain of tab … (from panel)`.

**Got:**
- Smooth crossfade
- Sometimes have to click the "crossfade" button on the sidepanel to effectively start the crossfade

## SM-06: The server decides on its own (console)

1. In the server terminal, type `list` to get the tab IDs.
2. Type `fade <otherTabId> 2`.
3. Type `gain <tabId> 0.3`.

**Expected:**
- Both changes are heard in OBS.
- The **panel follows**: sliders and `▶` move, even though nothing was clicked there. Its log shows `server: … (from console)`.

**Got:**
- Both changes effectively heard in OBS
- Panel follows and shows the logs

## SM-07: Stop decided by the server

1. In the server terminal, type `stop <tabId>`. Then do the same for the other tab with the panel's **Stop** button.

**Expected:**
- Server: `capture:stop sent to the extension`, then `source ended: tab … (stopped by the server)`.
- The row disappears from the "Spike: server mix" section. The tab stays in the version 1 list at the top: that list shows tabs that play audio, not sources.
- The tab is **audible again in Chrome**: its capture ended.
- In the service worker console, `await chrome.tabCapture.getCapturedTabs()` no longer lists it as `active`.

**Got:**
- Server logs correctly
- Row is still present in the panel list at the top, but not in the `spike: server mix` div, the volume sliders & crossfade zone have disappeared as expected and only the non-stoped tab is still present there

## SM-08: Navigating to another site (version 2 rule, decided by the server)

1. Capture a tab, then go to a page on another site in that tab, e.g. wikipedia.org.

**Expected:**
- Panel log: `tab … moved from … to …: reported to the server`.
- Server: `tab … moved from … to …`, then `stop tab … (moved to another site): capture:stop sent`, then `source ended`.
- Same-site navigation, like the next song on YouTube, does **not** stop it.

**Got:**
- Panel log appears
- Server logs appears in the right order
- Next song on Youtube does not stop it

## SM-09: Closing the panel doesn't stop the mix

1. With a source playing, close the side panel. Wait 10 s and check the OBS meter.
2. Reopen the panel: the toolbar button, or the side panel menu.

**Expected:**
1. The audio keeps flowing in OBS; the server prints `control client disconnected`.
2. The panel shows the current state straight away: same sources, gains and `▶`.

Note: reopening it with the toolbar button also captures the active tab.

**Got:**
- Audio keeps flowing in OBS
- Re-opening the panel shows the current state accordingly

## SM-10: Delay against the video

1. Capture a YouTube video with a clear beat or a clap, e.g. search "audio video sync test".
2. In OBS, add a **Window Capture** of that Chrome window. Watch the OBS preview with monitoring on, or record 20 s and watch the recording.

**Expected:** write down whether the sound is late compared with the picture, and roughly by how much (OBS: Advanced Audio Properties → Sync Offset, adjusted until it matches). Write it down for each backend you try.

**Got:**
- Delay of half a second

## SM-11: The streamer's monitoring

1. OBS monitoring, as set up: "Tab mix" on **Monitor and Output**.
2. Alternative, from the server:
   1. In OBS, set "Tab mix" to **Monitor Off**.
   2. Stop the server, then restart it with `TMA_MONITOR_DEVICE="External Headphones" pnpm --filter @tma/server spike`, or any other name from the device list.

**Expected:** for each option, write down whether the music is heard exactly once (no echo or doubling), and whether the extra delay is noticeable.

**Got:**
- OBS Monitoring: works, with the half-second delay
- Server alternative: works for a few seconds, then no sound anymore, and the following log: `[output] audify error: RtApiCore::closeStream(): no open stream to close!`

## SM-12: Stability (5 min, then 30 min)

1. Let one source play for 5 minutes, then check its row in the panel.
2. Leave two sources playing for 30 minutes. Write down the `[drift] tab …: buffer … ms` lines at the start and the end.

**Expected:**
1. No audible glitch; `underruns 0`, `overflow 0`, `seq gaps 0`.
2. A stable buffer means no clock drift. A steady climb towards 500 ms or a fall towards 0 (with underruns) means the clocks don't match: write down the rate (ms per minute). The offscreen `AudioContext` runs on Chrome's default output device's clock; the server runs on BlackHole's (audify) or the system clock (ffmpeg).

**Got:**
- Audible glitches, `underruns` grows with time, from 0 to 91 in 5mins, `overflow` & `seq gaps` stays at 0

## SM-13: Restarting the server

1. With a source playing, stop the server (Ctrl+C) and start it again.

**Expected:**
- While it's down, the panel shows `Server not reachable`, and the offscreen console logs `disconnected… retrying`.
- After the restart, both reconnect by themselves. The source comes back (`source added`), at gain 1 if it's the only one, and is heard again in OBS.

**Got:**
- Panel shows the `Server not reachable` & offscreen do to
- After restart, they do reconnect, it's heard again in OBS

## SM-14: Chrome closed

1. With a source playing, quit Chrome.

**Expected:** the server prints `capture client disconnected: sources removed`, keeps running and doesn't crash. OBS gets silence.

**Got:**
- Server does print the expected log, keeps running and OBS gets silence, as expected

## SM-15: CPU

1. With two sources playing, open Activity Monitor.

**Expected:** write down the CPU of the `node` process (the server), and of Chrome's "Extension: Twitch Multi Audio" process: Chrome menu → More Tools → Task Manager.

**Got:** not run in round 1, see R2-08.

---

# Round 2

What changed after round 1:
- **audify warnings no longer count as failures.** Round 1 treated the non-critical warning `closeStream(): no open stream to close!` as fatal. That marked the monitor output as failed, so it stopped receiving the mix (SM-11). Device listing now reuses one audify instance, which should also stop the warning (SM-01).
- **Panel rows are updated in place.** They used to be rebuilt every second, and a click landing during a rebuild was lost (SM-05).
- **Timing is measured** to find where the glitches (SM-12) and the delay (SM-10) come from:
  - Server, every 5 s, `[timing]`: the largest gap between two output render calls (ideal 10 ms), and the server's own latency (jitter buffer + output queue + device).
  - Server, every 5 s, `[drift]`: per source, the largest gap between two arriving blocks (ideal 10 ms).
  - Offscreen console, every 5 s, `[spike] … block gap max`: the same gap inside Chrome, before the network.
  - The panel shows the same figures under each source and in the output line.
- **Two buffer sizes can be changed without code**, through environment variables:
  - `TMA_JITTER_MS`: jitter buffer target (default 40).
  - `TMA_OUTPUT_QUEUE_BLOCKS`: 10 ms blocks written ahead of the device (default 2, so 20 ms).

  Bigger values mean fewer glitches but more delay.

Why glitches are expected with the defaults: in a check with silent fake audio, Node called the output's render every 18–35 ms instead of every 10 ms. With only 20 ms queued ahead of the device, a late call leaves the device without audio, which is a glitch. Round 1's underrun counter couldn't see that kind of glitch. R2-05 tests bigger queues.

**Setup:** the same as round 1. Rebuild and reload the extension (`pnpm --filter @tma/extension dev`, then reload in `chrome://extensions`), and restart the server.

## R2-01: The server opens BlackHole

On 2026-11-14, after BlackHole was installed and OBS was capturing it, opening BlackHole hung: both audify and ffmpeg stopped there. Other devices opened fine. The server stops after the `[output] audify devices:` line and never prints `listening`.

1. Start the server: `pnpm --filter @tma/server spike`.
2. If it stops after the devices line for more than 5 s, press Ctrl+C. Then try these, one at a time, restarting the server after each:
   1. Quit OBS completely, then start the server again (OBS can be reopened afterwards).
   2. Restart CoreAudio: `sudo killall coreaudiod`. It restarts by itself; sound stops for a second.
   3. Restart the Mac.

**Expected:** `[output] playing to "… BlackHole 2ch" with audify`, then `[config] jitter target 40 ms, output queue 20 ms`, then `listening`. Write down which step fixed it, if any. That tells us whether OBS can block the device.

**Got:**
```
pnpm --filter @tma/server spike

$ tsx src/spike/main.ts
[output] audify devices: [129] IVM: PL2875UH, [130] Blue Microphones: Yeti X, [132] Existential Audio Inc.: BlackHole 2ch, [134] Apple Inc.: External Headphones, [136] Apple Inc.: MacBook Pro Speakers
[output] playing to "Existential Audio Inc.: BlackHole 2ch" with audify
[config] jitter target 40 ms, output queue 20 ms
[console] commands: list | gain <tabId> <0-1> | fade <tabId> <seconds> | stop <tabId> | devices
[server] spike listening on ws://127.0.0.1:7531
```

## R2-02: No audify warning, the monitor output keeps playing (SM-11 again)

1. In OBS, set "Tab mix" to **Monitor Off**.
2. Start the server with `TMA_MONITOR_DEVICE="External Headphones" pnpm --filter @tma/server spike`.
3. Capture a tab and listen on the headphones for 2 minutes.

**Expected:**
- No `closeStream` line. If one appears, it's now printed as `audify warning`, not `error`.
- The panel's output line shows `Monitor: ✓` the whole time.
- The music never stops in the headphones.

**Got:**
- No `closeStream` line, as expected
- Panel's monitor is showing as expected the whole time
- Music never stops, as expected

## R2-03: Panel buttons work on the first click (SM-05 again)

**Preconditions:** two sources.

1. Click **Crossfade to** ten times, alternating between the two sources, at an irregular pace.
2. Drag a slider slowly for a few seconds, then release it outside the slider.

**Expected:**
1. Every click starts a crossfade straight away.
2. While dragging, the slider doesn't jump back. After releasing, it keeps following the server (e.g. a `gain` typed in the console moves it).

**Got:**
- Crossfade starts right away as expected
- Sliders don't jump and follow the server

## R2-04: Where the jitter comes from (default settings)

1. Start the server with the defaults. Capture one tab playing music, with OBS monitoring on.
2. Let it play for 5 minutes. Count the glitches you hear, roughly.
3. Copy the last two `[timing]` and `[drift]` lines from the server, and the last `[spike] … block gap` line from the offscreen console (`chrome://extensions` → the extension → "Inspect views: offscreen.html").

**Expected:** this case gathers data; there's no pass or fail. How to read it:
- **block gap** (Chrome) much above 10 ms: Chrome delivers the audio unevenly.
- **arrival gap** (server) much above **block gap**: the delay is added between Chrome and Node.
- **render gap** above the output queue (20 ms by default): the device runs dry, which is a glitch.
- **underruns** going up: an arrival gap was bigger than the jitter buffer.

**Got:**
```
[timing] render gap max 21.0 ms (worst 39.0), server latency ≈ 60 ms (jitter 40 + queue 20 + device 0.0)
[drift] tab 1056616779: buffer 60.0 ms, underruns 5, overflow 0 frames, seq gaps 0, arrival gap max 20.5 ms (worst 63.6)
[drift] tab 1056616782: buffer 40.0 ms, underruns 0, overflow 0 frames, seq gaps 0, arrival gap max 20.5 ms (worst 23.4)
```
- No audible jitters, smooth listening

## R2-05: Bigger buffers

Repeat R2-04 (5 minutes each) with these settings. Restart the server for each one.

| Run | Command | Server latency shown |
| --- | --- | --- |
| A | `TMA_OUTPUT_QUEUE_BLOCKS=5 pnpm --filter @tma/server spike` | ≈ 90 ms |
| B | `TMA_OUTPUT_QUEUE_BLOCKS=5 TMA_JITTER_MS=80 pnpm --filter @tma/server spike` | ≈ 130 ms |

**Expected:** fewer glitches than R2-04, ideally none in B. For each run, write down the glitch count, the underruns, the worst render gap and the worst arrival gap.

**Got:**
- A -> No glitches - `[timing] render gap max 17.9 ms (worst 64.6), server latency ≈ 90 ms (jitter 40 + queue 50 + device 0.0)
[drift] tab 1056616779: buffer 40.0 ms, underruns 0, overflow 0 frames, seq gaps 0, arrival gap max 22.3 ms (worst 26.4)
[drift] tab 1056616782: buffer 40.0 ms, underruns 0, overflow 0 frames, seq gaps 0, arrival gap max 22.3 ms (worst 26.4)`
- B -> No glitches - `[timing] render gap max 17.9 ms (worst 39.8), server latency ≈ 130 ms (jitter 80 + queue 50 + device 0.0)
[drift] tab 1056616779: buffer 80.0 ms, underruns 0, overflow 0 frames, seq gaps 0, arrival gap max 21.6 ms (worst 21.6)
[drift] tab 1056616782: buffer 70.0 ms, underruns 0, overflow 0 frames, seq gaps 0, arrival gap max 21.6 ms (worst 21.6)`

## R2-06: Delay without OBS (SM-10 again)

Separates the delay added by the extension and server from the delay added by OBS.

1. Start the server with the best settings from R2-05, plus `TMA_OUTPUT_DEVICE="External Headphones"`. The mix goes straight to the headphones, not to BlackHole.
2. Capture a YouTube "audio video sync test" video and watch it in Chrome with headphones on.
3. Estimate how late the sound is compared with the picture.
4. Restart the server with BlackHole (no `TMA_OUTPUT_DEVICE`) and OBS monitoring on. Compare in the same way, watching the OBS preview of a Window Capture.

**Expected:**
- Step 3 is close to the server latency in the panel (≈ 60–130 ms, depending on the settings), plus Chrome's capture delay.
- The difference between step 4 and step 3 is OBS's share: Audio Input Capture plus monitoring.

**Got:**
- Step 3 & 4 have the same half-second delay

## R2-07: Stability over 30 minutes (SM-12 again)

1. With the best settings from R2-05, leave two sources playing for 30 minutes.
2. Write down the `[drift]` lines at the start and at the end, and the glitches you heard.

**Expected:** no glitches, and underruns stay at 0 or near it. A steady rise or fall of the **buffer** value over the 30 minutes is clock drift: write down the rate in ms per minute.

**Got:**
- Captured with setting B from R2-05
- Start drift: `[timing] render gap max 44.1 ms (worst 44.1), server latency ≈ 130 ms (jitter 80 + queue 50 + device 0.0)
[drift] tab 1056616779: buffer 70.0 ms, underruns 0, overflow 0 frames, seq gaps 0, arrival gap max 18.7 ms (worst 18.7)
[drift] tab 1056616782: buffer 70.0 ms, underruns 0, overflow 0 frames, seq gaps 0, arrival gap max 19.2 ms (worst 19.2)`
- End drift: `[timing] render gap max 17.9 ms (worst 44.1), server latency ≈ 130 ms (jitter 80 + queue 50 + device 0.0)
[drift] tab 1056616779: buffer 70.0 ms, underruns 0, overflow 0 frames, seq gaps 0, arrival gap max 21.6 ms (worst 26.0)
[drift] tab 1056616782: buffer 70.0 ms, underruns 0, overflow 0 frames, seq gaps 0, arrival gap max 21.7 ms (worst 32.0)`


## R2-08: CPU (SM-15)

1. With two sources playing, open Activity Monitor.

**Expected:** write down the CPU of the `node` process (the server), and of Chrome's "Extension: Twitch Multi Audio" process: Chrome menu → More Tools → Task Manager.

**Got:**
- Node process: stable around 5% CPU
- Chrome Extension: stable around 6-7% CPU

---

# Round 3: where the half second comes from

Round 2 found about 0.5 s of delay even with the mix going straight to the headphones (R2-06), so OBS isn't the cause. The server accounts for about 130 ms at most. This round times one click through each stage, in milliseconds:

| Stage | From → to |
| --- | --- |
| Chrome capture | the page plays the click → the click leaves the offscreen document's worklet |
| to server | → the block holding it reaches the server (includes up to 10 ms of block filling) |
| jitter buffer + mix | → the mixer hands it to the output |
| output queue + device | → it comes back on BlackHole's input (BlackHole loops its output to its input; only with `TMA_PROBE=1` and BlackHole as output) |

The server prints one `[latency] click #n: …` line per click, and the median total. The same lines appear in the panel log.

Accuracy: about ±10 ms per stage. The page's click time is estimated from its own audio clock.

**Setup:**
1. Rebuild and reload the extension (`pnpm --filter @tma/extension dev`, then reload in `chrome://extensions`). **Required:** the audio frame format changed, and an old extension won't work with the new server.
2. Start the test page server: `pnpm --filter @tma/extension test:fixtures`.
3. Close or stop every other source, so the clicks are the only sound in the mix.

## R3-01: Reference without capture

Calibrates your eye and ear: the page's flash and its click, with nothing in between.

1. Open http://localhost:5310/click-page.html, don't capture it, and click **Start clicks**. Listen with headphones.

**Expected:** the click and the red flash look simultaneous. If the click already seems late here, that's your display and audio device, and it's the baseline for the next cases.

**Got:**
- Click & red flash are simultaneous

## R3-02: Delay breakdown through BlackHole

1. Start the server: `TMA_PROBE=1 TMA_OUTPUT_QUEUE_BLOCKS=5 pnpm --filter @tma/server spike`. It should print `[probe] loopback: recording "… BlackHole 2ch" input`.
2. Capture the click page tab (toolbar button), then click **Start clicks** on the page. The page shows `Server: connected`.
3. Let 20 clicks go by (40 s).
4. Copy the last three `[latency]` lines.
5. In OBS, with monitoring on, watch the page through a Window Capture and estimate how late the click is compared with the flash.

**Expected:**
- Every line has all four stages, with no `?`.
- The total is around 100–150 ms, unless one stage stands out: that's where the half second is.
- The difference between what you hear in step 5 and the measured total is OBS's share: Audio Input Capture plus monitoring.

**Got:**
```
[server] [latency] click #18: Chrome capture 42 ms, to server 9 ms, jitter buffer + mix 43 ms, output queue + device 68 ms → total 163 ms, median total 163 ms over 17 clicks
[timing] render gap max 16.3 ms (worst 61.6), server latency ≈ 90 ms (jitter 40 + queue 50 + device 0.0)
[drift] tab 1056616793: buffer 30.0 ms, underruns 0, overflow 0 frames, seq gaps 0, arrival gap max 17.3 ms (worst 21.5)
[server] [latency] click #19: Chrome capture 43 ms, to server 10 ms, jitter buffer + mix 40 ms, output queue + device 71 ms → total 164 ms, median total 163 ms over 18 clicks
[server] [latency] click #20: Chrome capture 41 ms, to server 5 ms, jitter buffer + mix 46 ms, output queue + device 70 ms → total 162 ms, median total 163 ms over 19 clicks
```

## R3-03: Straight to the headphones

1. Restart the server: `TMA_PROBE=1 TMA_OUTPUT_QUEUE_BLOCKS=5 TMA_OUTPUT_DEVICE="External Headphones" pnpm --filter @tma/server spike`. The loopback won't open, which is expected: headphones have no input.
2. With the click page captured, let 20 clicks go by. Copy the last three `[latency]` lines (the last stage shows `?`).
3. Watch the page's flash and listen in the headphones: estimate how late the click is.

**Expected:**
- The first three stages match R3-02.
- The heard delay minus the measured total (up to "jitter buffer + mix") is what the output queue, the headphones and your perception add.

**Got:**
```
[server] [latency] click #18: Chrome capture 42 ms, to server 10 ms, jitter buffer + mix 39 ms, output queue + device ? → total 91 ms (no loopback), median total 90 ms over 17 clicks
[server] [latency] click #19: Chrome capture 42 ms, to server 5 ms, jitter buffer + mix 45 ms, output queue + device ? → total 91 ms (no loopback), median total 91 ms over 18 clicks
[server] [latency] click #20: Chrome capture 43 ms, to server 9 ms, jitter buffer + mix 41 ms, output queue + device ? → total 93 ms (no loopback), median total 91 ms over 19 clicks
```
- Slightly less delay that way