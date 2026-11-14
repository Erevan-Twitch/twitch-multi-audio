/**
 * SPIKE (throwaway): ring buffer of interleaved Int16 stereo samples, used as a
 * jitter buffer per source (and as the queue feeding the monitor output).
 *
 * - Doesn't play until it holds `targetFrames` ("primed"), to absorb network jitter.
 * - Underrun: not enough data when the output asks → silence, and it primes again.
 * - Overflow: more than `capacityFrames` → the oldest frames are dropped.
 * A fill level that slowly rises or falls over minutes means clock drift.
 */
import { CHANNELS } from "./protocol.js";

export class JitterBuffer {
  private readonly data: Int16Array;
  private readIndex = 0; // in frames
  private fill = 0; // in frames
  primed = false;
  underruns = 0;
  overflowFrames = 0;

  constructor(
    private readonly capacityFrames: number,
    private readonly targetFrames: number,
  ) {
    this.data = new Int16Array(capacityFrames * CHANNELS);
  }

  get fillFrames(): number {
    return this.fill;
  }

  push(samples: Int16Array): void {
    let frames = samples.length / CHANNELS;
    let offset = 0;
    if (frames > this.capacityFrames) {
      // Keep only the newest part.
      offset = (frames - this.capacityFrames) * CHANNELS;
      this.overflowFrames += frames - this.capacityFrames;
      frames = this.capacityFrames;
    }
    const overflow = this.fill + frames - this.capacityFrames;
    if (overflow > 0) {
      this.readIndex = (this.readIndex + overflow) % this.capacityFrames;
      this.fill -= overflow;
      this.overflowFrames += overflow;
    }
    let writeIndex = (this.readIndex + this.fill) % this.capacityFrames;
    for (let i = 0; i < frames; i++) {
      this.data[writeIndex * CHANNELS] = samples[offset + i * CHANNELS]!;
      this.data[writeIndex * CHANNELS + 1] = samples[offset + i * CHANNELS + 1]!;
      writeIndex = (writeIndex + 1) % this.capacityFrames;
    }
    this.fill += frames;
    if (!this.primed && this.fill >= this.targetFrames) this.primed = true;
  }

  /**
   * Reads `frames` frames into `out` (Float32, interleaved), adding sample × gain.
   * `gainAt(i)` gives the gain for frame i, so ramps are sample-accurate.
   * Returns false when nothing was read (not primed, or underrun).
   */
  mixInto(out: Float32Array, frames: number, gainAt: (frame: number) => number): boolean {
    if (!this.primed) return false;
    if (this.fill < frames) {
      this.underruns++;
      this.primed = false;
      return false;
    }
    let index = this.readIndex;
    for (let i = 0; i < frames; i++) {
      const g = gainAt(i) / 32768;
      out[i * CHANNELS]! += this.data[index * CHANNELS]! * g;
      out[i * CHANNELS + 1]! += this.data[index * CHANNELS + 1]! * g;
      index = (index + 1) % this.capacityFrames;
    }
    this.readIndex = index;
    this.fill -= frames;
    return true;
  }

  /** Reads `frames` frames as Int16 (silence on underrun). Used by the monitor queue. */
  read(frames: number): Int16Array {
    const out = new Float32Array(frames * CHANNELS);
    this.mixInto(out, frames, () => 1);
    return floatToInt16(out);
  }
}

export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}
