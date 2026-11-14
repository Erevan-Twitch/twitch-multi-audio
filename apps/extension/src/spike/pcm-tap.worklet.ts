/**
 * SPIKE (throwaway): server-side mix test. AudioWorklet that turns a captured tab's
 * audio into 10 ms blocks of interleaved Int16 stereo, posted to the offscreen
 * document, which sends them to the server.
 * Loaded with `audioWorklet.addModule()`: no imports, runs in the AudioWorkletGlobalScope.
 */

const BLOCK_FRAMES = 480;

// The DOM lib has no AudioWorkletGlobalScope types: describe what's used here.
interface WorkletScope {
  AudioWorkletProcessor: new () => { readonly port: MessagePort };
  registerProcessor(name: string, processor: unknown): void;
}
const scope = globalThis as unknown as WorkletScope;

class PcmTap extends scope.AudioWorkletProcessor {
  private block = new Int16Array(BLOCK_FRAMES * 2);
  private filled = 0;

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0] ?? [];
    const left = channels[0];
    const right = channels[1] ?? left;
    const length = left?.length ?? 128;
    for (let i = 0; i < length; i++) {
      this.block[this.filled * 2] = toInt16(left?.[i] ?? 0);
      this.block[this.filled * 2 + 1] = toInt16(right?.[i] ?? 0);
      if (++this.filled === BLOCK_FRAMES) {
        this.port.postMessage(this.block, [this.block.buffer]);
        this.block = new Int16Array(BLOCK_FRAMES * 2);
        this.filled = 0;
      }
    }
    // Outputs stay silent: the tab is only heard through the server.
    return true;
  }
}

function toInt16(sample: number): number {
  const s = Math.max(-1, Math.min(1, sample));
  return s < 0 ? s * 32768 : s * 32767;
}

scope.registerProcessor("pcm-tap", PcmTap);
