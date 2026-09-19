import { parseDeadlineIso } from "../deadline";

/**
 * How one tournament reads on a member's list of their club's tournaments.
 *
 * Pure, so every rule here is tested without a database, and derived from the
 * same `registrationStatus` the organizer's screen and the public entry form
 * read — this only decides how to SAY it, never whether entries are open.
 */

/** The coloured band across the top of the card. */
export type EventBand = "entered" | "open" | "soon" | "live" | "finished" | "closed";

export const BAND_LABEL: Record<EventBand, string> = {
  entered: "You’re in",
  open: "Open for entries",
  soon: "Opens soon",
  live: "On now",
  finished: "Finished",
  closed: "Closed",
};

/**
 * Which band, in priority order.
 *
 * FINISHED beats everything: a result is what a member opens a finished
 * tournament for, whether or not they played in it. Then ENTERED, because the
 * member's own place is the fact they care about most. Then ON NOW, OPEN, OPENS
 * SOON, and CLOSED for everything else — full with no waiting list, past the
 * deadline, shut by the organizer, or never opened to self entry.
 */
export function eventBand(i: {
  eventStatus: string;
  /** `registrationStatus(...).state`. */
  regState: string;
  canEnter: boolean;
  entered: boolean;
}): EventBand {
  if (i.eventStatus === "completed") return "finished";
  if (i.entered) return "entered";
  if (i.eventStatus === "live") return "live";
  if (i.canEnter) return "open";
  if (i.regState === "not-open-yet") return "soon";
  return "closed";
}

/**
 * The order a member reads the list in: their own first, then what is being
 * played, then what they can enter, what opens next, and last what is shut or
 * over. Within a band the server's order stands (newest first). It was
 * newest-created only, which put a finished tournament at the top of the list
 * and the member's own entry at the bottom — found by looking at it.
 */
export const BAND_ORDER: readonly EventBand[] = ["entered", "live", "open", "soon", "closed", "finished"];

export function byBand<T extends { band: EventBand }>(rows: readonly T[]): T[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => BAND_ORDER.indexOf(a.r.band) - BAND_ORDER.indexOf(b.r.band) || a.i - b.i)
    .map(({ r }) => r);
}

/** Which "When" filter a band belongs under. */
export function whenOf(band: EventBand): "upcoming" | "now" | "finished" {
  if (band === "finished") return "finished";
  if (band === "live") return "now";
  return "upcoming";
}

/** Whole days from `fromIso` to `toIso`, both yyyy-mm-dd. */
function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

function inDays(n: number, what: string): string {
  if (n <= 0) return `${what} today`;
  if (n === 1) return `${what} tomorrow`;
  return `${what} in ${n} days`;
}

/**
 * The line that makes the dates urgent: "Closes in 9 days", "Entries open
 * tomorrow". Only for a date that parses, only for the band it is about, and
 * "" otherwise — a countdown to a date nobody set is worse than none.
 */
export function entryWindowNote(i: { band: EventBand; opens: string; closes: string; today: string }): string {
  if (i.band === "soon") {
    const o = parseDeadlineIso(i.opens);
    return o ? inDays(daysBetween(i.today, o), "Entries open") : "";
  }
  if (i.band === "open") {
    const c = parseDeadlineIso(i.closes);
    if (!c) return "";
    const n = daysBetween(i.today, c);
    // Past the date and still open is the organizer's extension — the band
    // already says Open, so there is no countdown to give.
    return n < 0 ? "" : inDays(n, "Closes");
  }
  return "";
}

/**
 * How far through the entry window today is, 0 to 1 — or null when the window
 * has no two real ends to measure between. Drawn as the bar under the dates.
 */
export function entryProgress(opens: string, closes: string, today: string): number | null {
  const o = parseDeadlineIso(opens);
  const c = parseDeadlineIso(closes);
  if (!o || !c) return null;
  const span = daysBetween(o, c);
  if (span <= 0) return null;
  return Math.min(1, Math.max(0, daysBetween(o, today) / span));
}

/**
 * "18 of 32 places left", "Full — waiting list open", or "" for a field with
 * no limit (capacity 0 or less) — there is no count to give.
 */
export function placesNote(capacity: number, confirmed: number, waitlisting: boolean): string {
  if (capacity <= 0) return "";
  if (waitlisting) return "Full — waiting list open";
  const left = Math.max(0, capacity - confirmed);
  return `${left} of ${capacity} places left`;
}
