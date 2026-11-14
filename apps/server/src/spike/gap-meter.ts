/**
 * SPIKE (throwaway): measures timing jitter. Records the largest gap between two
 * `tick()` calls since the last `take()`. Used for block arrivals per source and for
 * the output's render calls: 10 ms blocks should give gaps close to 10 ms.
 */
export class GapMeter {
  private last: number | undefined;
  private max = 0;
  /** Largest gap ever seen, in ms. */
  worst = 0;

  tick(now = performance.now()): void {
    if (this.last !== undefined) {
      const gap = now - this.last;
      if (gap > this.max) this.max = gap;
      if (gap > this.worst) this.worst = gap;
    }
    this.last = now;
  }

  /** Largest gap since the previous call, in ms; then starts a new window. */
  take(): number {
    const max = this.max;
    this.max = 0;
    return max;
  }
}
