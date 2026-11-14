/**
 * SPIKE (throwaway): the server's mixer. Holds one jitter buffer and one gain per
 * source, and renders the mix when the output asks for audio.
 * Gain changes are linear ramps, sample-accurate, as in the tab capture spike.
 */
import { GapMeter } from "./gap-meter.js";
import { JitterBuffer, floatToInt16 } from "./jitter-buffer.js";
import { CHANNELS, SAMPLE_RATE, type SourceView } from "./protocol.js";

/** Jitter buffer target. More = fewer underruns, more delay. Round 1 used 40 ms. */
export const TARGET_MS = Math.max(10, Number(process.env.TMA_JITTER_MS ?? 40));
const CAPACITY_MS = 500;
/** Short ramp for plain gain changes, to avoid clicks. */
const GAIN_RAMP_S = 0.02;

const msToFrames = (ms: number) => Math.round((ms * SAMPLE_RATE) / 1000);

interface Source {
  label: string;
  buffer: JitterBuffer;
  gain: number;
  targetGain: number;
  /** Gain change per frame while ramping. */
  step: number;
  framesReceived: number;
  lastSeq: number | null;
  seqGaps: number;
  /** Time between two blocks arriving: should stay close to 10 ms. */
  arrivals: GapMeter;
  maxArrivalGapMs: number;
}

export class Mixer {
  private readonly sources = new Map<number, Source>();
  activeTabId: number | null = null;

  add(tabId: number, label: string): void {
    const existing = this.sources.get(tabId);
    if (existing) {
      existing.label = label;
      return;
    }
    // A new source starts at full volume only if nothing else is playing.
    const gain = this.sources.size === 0 ? 1 : 0;
    this.sources.set(tabId, {
      label,
      buffer: new JitterBuffer(msToFrames(CAPACITY_MS), msToFrames(TARGET_MS)),
      gain,
      targetGain: gain,
      step: 0,
      framesReceived: 0,
      lastSeq: null,
      seqGaps: 0,
      arrivals: new GapMeter(),
      maxArrivalGapMs: 0,
    });
    if (gain === 1) this.activeTabId = tabId;
  }

  remove(tabId: number): void {
    this.sources.delete(tabId);
    if (this.activeTabId === tabId) this.activeTabId = null;
  }

  has(tabId: number): boolean {
    return this.sources.has(tabId);
  }

  ids(): number[] {
    return [...this.sources.keys()];
  }

  /**
   * Audio from the extension. Frames for unknown sources are ignored: the extension
   * always sends `source:added` first, and late frames after a stop must not bring a source back.
   */
  push(tabId: number, seq: number, samples: Int16Array): void {
    const source = this.sources.get(tabId);
    if (!source) return;
    source.arrivals.tick();
    if (source.lastSeq !== null && seq !== source.lastSeq + 1) source.seqGaps += Math.max(1, seq - source.lastSeq - 1);
    source.lastSeq = seq;
    source.framesReceived += samples.length / CHANNELS;
    source.buffer.push(samples);
  }

  setGain(tabId: number, gain: number): boolean {
    const source = this.sources.get(tabId);
    if (!source) return false;
    this.rampTo(source, Math.max(0, Math.min(1, gain)), GAIN_RAMP_S);
    return true;
  }

  /** Ramps the chosen source to 1 and every other one to 0. */
  crossfade(tabId: number, seconds: number): boolean {
    if (!this.sources.has(tabId)) return false;
    for (const [id, source] of this.sources) this.rampTo(source, id === tabId ? 1 : 0, seconds);
    this.activeTabId = tabId;
    return true;
  }

  private rampTo(source: Source, target: number, seconds: number): void {
    const frames = Math.max(1, Math.round(Math.max(seconds, 0.01) * SAMPLE_RATE));
    source.targetGain = target;
    source.step = (target - source.gain) / frames;
  }

  /** Called by the output for every block it needs. Returns interleaved Int16 stereo. */
  render(frames: number): Int16Array {
    const mix = new Float32Array(frames * CHANNELS);
    for (const source of this.sources.values()) {
      const start = source.gain;
      const { step, targetGain } = source;
      const gainAt = (i: number) => {
        const g = start + step * (i + 1);
        return step > 0 ? Math.min(g, targetGain) : step < 0 ? Math.max(g, targetGain) : start;
      };
      source.buffer.mixInto(mix, frames, gainAt);
      // The ramp advances even when the buffer had nothing to play.
      source.gain = gainAt(frames - 1);
      if (source.gain === targetGain) source.step = 0;
    }
    return floatToInt16(mix);
  }

  views(): SourceView[] {
    return [...this.sources].map(([tabId, s]) => ({
      tabId,
      label: s.label,
      gain: s.gain,
      targetGain: s.targetGain,
      bufferMs: (s.buffer.fillFrames / SAMPLE_RATE) * 1000,
      primed: s.buffer.primed,
      underruns: s.buffer.underruns,
      overflowFrames: s.buffer.overflowFrames,
      seqGaps: s.seqGaps,
      framesReceived: s.framesReceived,
      maxArrivalGapMs: s.maxArrivalGapMs,
      worstArrivalGapMs: s.arrivals.worst,
    }));
  }

  /** Closes the arrival-gap window of every source (called every 5 s). */
  rollWindow(): void {
    for (const source of this.sources.values()) source.maxArrivalGapMs = source.arrivals.take();
  }
}
