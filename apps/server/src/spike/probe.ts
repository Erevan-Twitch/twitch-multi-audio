/**
 * SPIKE (throwaway), round 3: breaks the end-to-end delay down by stage.
 *
 * The click page (apps/extension/test/fixtures/click-page.html) plays a short loud click
 * every 2 s in a captured tab and tells the server when it played it. The server finds that
 * click at each stage by looking for a sudden loud sample after silence:
 *   page    the page played the click (sent by the page)
 *   capture the click's sample left Chrome's capture (block timestamp from the offscreen document)
 *   arrive  the block holding it reached the server
 *   render  the mixer handed it to the output (it then waits in the output queue)
 *   loop    it came back on BlackHole's input: output queue + driver + device (loopback, TMA_PROBE=1)
 * All times are epoch ms (Date.now() clock), shared by Chrome and Node on the same machine.
 */
import { CHANNELS, SAMPLE_RATE } from "./protocol.js";

/** Finds a click: a sample above `threshold` after at least `quietMs` below it. */
export class OnsetDetector {
  private quietSince: number | undefined;

  constructor(
    private readonly threshold = 0.3 * 32768,
    private readonly quietMs = 400,
  ) {}

  /** `firstSampleAt`: epoch ms of samples[0]. Returns the onset's epoch ms, if any. */
  feed(samples: Int16Array, firstSampleAt: number): number | undefined {
    let onset: number | undefined;
    const frames = samples.length / CHANNELS;
    for (let i = 0; i < frames; i++) {
      const t = firstSampleAt + (i / SAMPLE_RATE) * 1000;
      const loud = Math.abs(samples[i * CHANNELS]!) > this.threshold || Math.abs(samples[i * CHANNELS + 1]!) > this.threshold;
      if (!loud) {
        this.quietSince ??= t;
        continue;
      }
      if (onset === undefined && this.quietSince !== undefined && t - this.quietSince >= this.quietMs) onset = t;
      this.quietSince = undefined;
    }
    return onset;
  }
}

type Stage = "capture" | "arrive" | "render" | "loop";

interface ClickRecord {
  id: number;
  page: number;
  times: Partial<Record<Stage, number>>;
}

/** Collects the stage times of each click and prints one line per click. */
export class LatencyProbe {
  private readonly records: ClickRecord[] = [];
  private readonly totals: number[] = [];

  constructor(private readonly report: (line: string) => void) {}

  click(id: number, at: number): void {
    const record: ClickRecord = { id, page: at, times: {} };
    this.records.push(record);
    if (this.records.length > 20) this.records.shift();
    // Everything should be in well within 1.5 s; report then, with whatever was found.
    setTimeout(() => this.print(record), 1500);
  }

  stage(stage: Stage, at: number): void {
    // The latest click played before this time (50 ms slack for timestamp estimates), not yet matched.
    for (let i = this.records.length - 1; i >= 0; i--) {
      const record = this.records[i]!;
      if (record.page - 50 > at) continue;
      if (at - record.page > 1500) return;
      if (record.times[stage] === undefined) record.times[stage] = at;
      return;
    }
  }

  private print(record: ClickRecord): void {
    const { page, times } = record;
    const step = (from: number | undefined, to: number | undefined) =>
      from !== undefined && to !== undefined ? `${(to - from).toFixed(0)} ms` : "?";
    const last = times.loop ?? times.render;
    const total = last !== undefined ? last - page : undefined;
    if (total !== undefined) this.totals.push(total);
    const median = [...this.totals].sort((a, b) => a - b)[Math.floor(this.totals.length / 2)];
    this.report(
      `[latency] click #${record.id}: ` +
        `Chrome capture ${step(page, times.capture)}, ` +
        `to server ${step(times.capture, times.arrive)}, ` +
        `jitter buffer + mix ${step(times.arrive, times.render)}, ` +
        `output queue + device ${step(times.render, times.loop)} → ` +
        `total ${total !== undefined ? `${total.toFixed(0)} ms` : "?"}${times.loop === undefined ? " (no loopback)" : ""}` +
        (median !== undefined ? `, median total ${median.toFixed(0)} ms over ${this.totals.length} clicks` : ""),
    );
  }
}
