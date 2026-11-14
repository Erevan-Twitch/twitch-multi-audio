/**
 * SPIKE (throwaway): writes the mix to an output device (BlackHole 2ch, captured by OBS).
 *
 * Two backends:
 * - "audify": RtAudio bindings, in process. The device's clock paces the mixer:
 *   each block that finishes playing asks for the next one. Optional dependency
 *   (`pnpm --filter @tma/server add audify`), loaded only if installed.
 * - "ffmpeg": pipes raw PCM to `ffmpeg -f audiotoolbox` (macOS). No extra
 *   dependency, but a Node timer paces the mixer, so latency is higher and
 *   drift is measured against the system clock instead of the device's.
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { GapMeter } from "./gap-meter.js";
import { BLOCK_FRAMES, CHANNELS, SAMPLE_RATE } from "./protocol.js";

export type Backend = "audify" | "ffmpeg";
export type Render = (frames: number) => Int16Array;

export interface OutputInfo {
  backend: string;
  device: string;
  ok: boolean;
  error?: string;
}

export interface OutputTiming {
  /** Audio written but not played yet, on our side (audify queue, or ffmpeg's lead). */
  queuedMs: number;
  /** Latency reported by the device driver (audify only). */
  deviceLatencyMs: number | null;
  /** Largest gap between two render calls since the last call to `timing()`. */
  maxRenderGapMs: number;
  worstRenderGapMs: number;
}

export interface AudioOutput {
  readonly info: OutputInfo;
  /** Starts pulling audio from `render`, one block at a time. */
  start(render: Render): void;
  stop(): void;
  timing(): OutputTiming;
}

/** Blocks (10 ms each) written ahead of the device. More = fewer glitches, more delay. */
const QUEUE_BLOCKS = Math.max(1, Number(process.env.TMA_OUTPUT_QUEUE_BLOCKS ?? 2));

export interface DeviceEntry {
  id: number;
  name: string;
}

// ---------------------------------------------------------------- audify

/** The small part of audify's API used here (audify ships its own types; this avoids depending on it). */
interface RtAudioDevice {
  id?: number;
  name: string;
  outputChannels: number;
  inputChannels: number;
}
interface RtAudioInstance {
  getDevices(): RtAudioDevice[];
  openStream(
    output: { deviceId: number; nChannels: number; firstChannel: number } | null,
    input: { deviceId: number; nChannels: number; firstChannel: number } | null,
    format: number,
    sampleRate: number,
    frameSize: number,
    streamName: string,
    inputCallback: ((pcm: Buffer) => void) | null,
    frameOutputCallback: (() => void) | null,
    flags?: number,
    errorCallback?: (type: number, message: string) => void,
  ): number;
  start(): void;
  stop(): void;
  closeStream(): void;
  isStreamOpen(): boolean;
  write(pcm: Buffer): void;
  getStreamLatency(): number;
}
interface AudifyModule {
  RtAudio: new () => RtAudioInstance;
  RtAudioFormat: { RTAUDIO_SINT16: number };
}

/** audify's RtAudioErrorType: 0 = WARNING, 1 = DEBUG_WARNING are "non-critical". */
const AUDIFY_WARNING_TYPES = new Set([0, 1]);

/**
 * One RtAudio instance for listing devices, kept for the whole run. Instances created
 * and dropped on the fly print "closeStream(): no open stream to close!" when the
 * garbage collector destroys them (round 1, SM-01 and SM-11).
 */
let listingInstance: RtAudioInstance | undefined;
/** Open streams, referenced so they're never garbage-collected while playing. */
const streams: RtAudioInstance[] = [];

let audifyLoadError: string | undefined;
let audifyWarned = false;

function loadAudify(): AudifyModule | undefined {
  try {
    return createRequire(import.meta.url)("audify") as AudifyModule;
  } catch (error) {
    // Not installed is expected (ffmpeg fallback). Anything else, e.g. a missing native
    // binary because pnpm skipped its install script, must be visible.
    const notInstalled = (error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND" && errorText(error).includes("'audify'");
    if (!notInstalled) {
      audifyLoadError = errorText(error);
      if (!audifyWarned) console.error(`[output] audify is installed but failed to load: ${audifyLoadError}`);
      audifyWarned = true;
    }
    return undefined;
  }
}

function audifyDevices(audify: AudifyModule): DeviceEntry[] {
  listingInstance ??= new audify.RtAudio();
  return listingInstance
    .getDevices()
    .map((d, index) => ({ id: d.id ?? index, name: d.name, outputChannels: d.outputChannels }))
    .filter((d) => d.outputChannels > 0)
    .map(({ id, name }) => ({ id, name }));
}

function openAudify(audify: AudifyModule, deviceName: string): AudioOutput {
  let devices: DeviceEntry[];
  try {
    devices = audifyDevices(audify);
  } catch (error) {
    return failed("audify", deviceName, `listing devices failed: ${errorText(error)}`);
  }
  const device = devices.find((d) => d.name.includes(deviceName));
  if (!device) return failed("audify", deviceName, `no output device matching "${deviceName}"`);

  // Kept in `streams` so it lives as long as the process.
  const rt = new audify.RtAudio();
  streams.push(rt);
  const info: OutputInfo = { backend: "audify", device: device.name, ok: true };
  const renderGaps = new GapMeter();
  let render: Render | undefined;
  const writeBlock = () => {
    if (!render) return;
    renderGaps.tick();
    const pcm = render(BLOCK_FRAMES);
    rt.write(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  };
  try {
    rt.openStream(
      { deviceId: device.id, nChannels: CHANNELS, firstChannel: 0 },
      null,
      audify.RtAudioFormat.RTAUDIO_SINT16,
      SAMPLE_RATE,
      BLOCK_FRAMES,
      "twitch-multi-audio spike",
      null,
      // Called each time a block finished playing: queue the next one.
      writeBlock,
      0,
      (type, message) => {
        if (AUDIFY_WARNING_TYPES.has(type)) {
          console.warn(`[output] audify warning (${device.name}): ${message}`);
          return;
        }
        info.ok = false;
        info.error = message;
        console.error(`[output] audify error ${type} (${device.name}): ${message}`);
      },
    );
  } catch (error) {
    return failed("audify", device.name, errorText(error));
  }
  return {
    info,
    start(r) {
      render = r;
      // Blocks queued ahead so the device never waits on Node.
      for (let i = 0; i < QUEUE_BLOCKS; i++) writeBlock();
      rt.start();
    },
    timing() {
      let deviceLatencyMs: number | null = null;
      try {
        deviceLatencyMs = (rt.getStreamLatency() / SAMPLE_RATE) * 1000;
      } catch {
        // Not available for this device.
      }
      return {
        queuedMs: QUEUE_BLOCKS * 10,
        deviceLatencyMs,
        maxRenderGapMs: renderGaps.take(),
        worstRenderGapMs: renderGaps.worst,
      };
    },
    stop() {
      render = undefined;
      try {
        rt.stop();
        rt.closeStream();
      } catch {
        // Already closed.
      }
    },
  };
}

/**
 * Round 3: records a device's input. BlackHole loops its output back to its input, so
 * the server can hear its own mix after the output queue, the driver and the device.
 * `onPcm` gets each 10 ms block with the epoch ms of its first sample (estimated).
 */
export function openLoopbackInput(deviceName: string, onPcm: (pcm: Int16Array, firstSampleAt: number) => void): string {
  const audify = loadAudify();
  if (!audify) return "loopback needs audify";
  const device = (listingInstance ?? new audify.RtAudio())
    .getDevices()
    .map((d, index) => ({ id: d.id ?? index, name: d.name, inputChannels: d.inputChannels }))
    .find((d) => d.name.includes(deviceName) && d.inputChannels >= CHANNELS);
  if (!device) return `no input device matching "${deviceName}"`;
  const rt = new audify.RtAudio();
  streams.push(rt);
  try {
    rt.openStream(
      null,
      { deviceId: device.id, nChannels: CHANNELS, firstChannel: 0 },
      audify.RtAudioFormat.RTAUDIO_SINT16,
      SAMPLE_RATE,
      BLOCK_FRAMES,
      "twitch-multi-audio loopback",
      (pcm) => {
        // The callback fires once the block is fully recorded: its first sample is 10 ms older.
        const samples = new Int16Array(pcm.byteLength / 2);
        Buffer.from(samples.buffer).set(pcm);
        onPcm(samples, Date.now() - (BLOCK_FRAMES / SAMPLE_RATE) * 1000);
      },
      null,
      0,
      (type, message) => console.warn(`[loopback] audify ${AUDIFY_WARNING_TYPES.has(type) ? "warning" : `error ${type}`}: ${message}`),
    );
    rt.start();
  } catch (error) {
    return `loopback failed: ${errorText(error)}`;
  }
  return `recording "${device.name}" input`;
}

// ---------------------------------------------------------------- ffmpeg

function ffmpegDevices(): DeviceEntry[] {
  // ffmpeg prints the CoreAudio device list on stderr, then exits.
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-f", "lavfi", "-i", "anullsrc", "-t", "0", "-f", "audiotoolbox", "-list_devices", "true", "-"],
    { encoding: "utf8" },
  );
  const devices: DeviceEntry[] = [];
  for (const match of (result.stderr ?? "").matchAll(/\]\s+\[(\d+)\]\s+(.+?),\s/g)) {
    if (match[2]!.includes("(null)")) continue;
    devices.push({ id: Number(match[1]), name: match[2]!.trim() });
  }
  return devices;
}

/** How far ahead of real time the ffmpeg backend writes. */
const FFMPEG_LEAD_MS = 40;

function openFfmpeg(deviceName: string): AudioOutput {
  const device = ffmpegDevices().find((d) => d.name.includes(deviceName));
  if (!device) return failed("ffmpeg", deviceName, `no CoreAudio device matching "${deviceName}" (is ffmpeg installed?)`);

  const info: OutputInfo = { backend: "ffmpeg", device: device.name, ok: true };
  let child: ChildProcessWithoutNullStreams | undefined;
  let timer: NodeJS.Timeout | undefined;
  const renderGaps = new GapMeter();
  return {
    info,
    timing() {
      return { queuedMs: FFMPEG_LEAD_MS, deviceLatencyMs: null, maxRenderGapMs: renderGaps.take(), worstRenderGapMs: renderGaps.worst };
    },
    start(render) {
      child = spawn("ffmpeg", [
        "-hide_banner", "-loglevel", "warning",
        "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", String(CHANNELS), "-i", "pipe:0",
        "-f", "audiotoolbox", "-audio_device_index", String(device.id), "-",
      ]);
      child.stderr.on("data", (data: Buffer) => console.error(`[output] ffmpeg: ${data.toString().trim()}`));
      child.on("exit", (code) => {
        info.ok = false;
        info.error = `ffmpeg exited (${code})`;
        if (timer) clearInterval(timer);
      });
      child.stdin.on("error", () => undefined);

      const startedAt = performance.now();
      let framesWritten = 0;
      timer = setInterval(() => {
        const due = ((performance.now() - startedAt + FFMPEG_LEAD_MS) / 1000) * SAMPLE_RATE;
        while (framesWritten + BLOCK_FRAMES <= due) {
          renderGaps.tick();
          const pcm = render(BLOCK_FRAMES);
          child?.stdin.write(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
          framesWritten += BLOCK_FRAMES;
        }
      }, 5);
    },
    stop() {
      if (timer) clearInterval(timer);
      child?.stdin.end();
      child?.kill();
    },
  };
}

// ---------------------------------------------------------------- common

function failed(backend: string, device: string, error: string): AudioOutput {
  return {
    info: { backend, device, ok: false, error },
    start() {},
    stop() {},
    timing: () => ({ queuedMs: 0, deviceLatencyMs: null, maxRenderGapMs: 0, worstRenderGapMs: 0 }),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Uses audify when installed (unless `preferred` says otherwise), else ffmpeg. */
export function openOutput(deviceName: string, preferred?: Backend): AudioOutput {
  const audify = preferred === "ffmpeg" ? undefined : loadAudify();
  if (audify) return openAudify(audify, deviceName);
  if (preferred === "audify") return failed("audify", deviceName, audifyLoadError ?? "audify is not installed");
  return openFfmpeg(deviceName);
}

export function listDevices(preferred?: Backend): { backend: Backend; devices: DeviceEntry[] } {
  const audify = preferred === "ffmpeg" ? undefined : loadAudify();
  if (audify) {
    try {
      return { backend: "audify", devices: audifyDevices(audify) };
    } catch (error) {
      console.error(`[output] audify device listing failed: ${errorText(error)}`);
    }
  }
  return { backend: "ffmpeg", devices: ffmpegDevices() };
}
