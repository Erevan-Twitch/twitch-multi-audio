/**
 * Exchange between the page-context hook (page-hook.ts, `world: "MAIN"`) and the
 * content script (media-session.ts, isolated world). Both share only the DOM, so
 * they talk with DOM events: the content script dispatches a query event, and the
 * hook answers synchronously with a report event whose detail is a JSON string.
 *
 * The page can see and send these events too, so reports are validated and only
 * used for display.
 */

export const QUERY_EVENT = "tma:media-query";
export const REPORT_EVENT = "tma:media-report";

/** State of one media element, as both sides use it. */
export interface ElementState {
  muted: boolean;
  /** The `muted` attribute is declared in the HTML (decorative videos). */
  defaultMuted: boolean;
  volume: number;
  paused: boolean;
  ended: boolean;
}

export function toElementState(element: HTMLMediaElement): ElementState {
  return {
    muted: element.muted,
    defaultMuted: element.defaultMuted,
    volume: element.volume,
    paused: element.paused,
    ended: element.ended,
  };
}

function isElementState(value: unknown): value is ElementState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.muted === "boolean" &&
    typeof v.defaultMuted === "boolean" &&
    typeof v.volume === "number" &&
    typeof v.paused === "boolean" &&
    typeof v.ended === "boolean"
  );
}

/** Parses a report's detail, dropping anything malformed. */
export function parseReport(detail: unknown): ElementState[] {
  if (typeof detail !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(detail);
    return Array.isArray(parsed) ? parsed.filter(isElementState) : [];
  } catch {
    return [];
  }
}
