/**
 * Runs in the page's own JavaScript context (`world: "MAIN"`) from document_start.
 *
 * Some players keep their <audio> element out of the page (`new Audio()`), so the
 * content script can't find it with querySelectorAll (e.g. Chillhop, which also
 * "mutes" by setting `volume` to 0, which Chrome still reports as audible).
 * Wrapping HTMLMediaElement.prototype.play catches every element that starts
 * playing, in or out of the page; the content script asks for their state.
 *
 * No access to chrome.* APIs here: this is page context.
 */
import { QUERY_EVENT, REPORT_EVENT, toElementState } from "./page-bridge.js";

declare global {
  // Set once per page, so a second injection doesn't wrap play() twice. This
  // context isn't reset when the extension reloads, so the first hook keeps working.
  var __tmaPageHook: true | undefined;
}

function install(): void {
  globalThis.__tmaPageHook = true;

  // Weak references, so elements the page drops can still be garbage collected.
  const tracked = new Set<WeakRef<HTMLMediaElement>>();
  const originalPlay = HTMLMediaElement.prototype.play;

  HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement): Promise<void> {
    const alreadyTracked = [...tracked].some((ref) => ref.deref() === this);
    if (!alreadyTracked) tracked.add(new WeakRef(this));
    return originalPlay.call(this);
  };

  document.addEventListener(QUERY_EVENT, () => {
    const detached: ReturnType<typeof toElementState>[] = [];
    for (const ref of tracked) {
      const element = ref.deref();
      if (!element) {
        tracked.delete(ref);
        continue;
      }
      // Elements in the page are already read by the content script.
      if (!element.isConnected && (element.currentSrc || element.srcObject)) {
        detached.push(toElementState(element));
      }
    }
    document.dispatchEvent(new CustomEvent(REPORT_EVENT, { detail: JSON.stringify(detached) }));
  });
}

if (!globalThis.__tmaPageHook) install();
