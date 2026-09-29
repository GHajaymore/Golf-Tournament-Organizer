/**
 * PACE OF PLAY — which groups are keeping up with the time allowed, and which
 * are not, read off the tee sheet, the cards and the clock.
 *
 * The committee's question on the day is never "how fast is the field", it is
 * "who do I send a ranger to". A group is measured against its OWN schedule:
 * off at its tee time, allowed a fixed number of minutes a hole, so by now it
 * should have finished so many holes. The cards say how many it has.
 *
 * THE MEASURE IS A LOWER BOUND, deliberately. A group has certainly fallen
 * behind once the time allowed for the hole it is on has run out and no score
 * has come in for it — `behind` is how long ago that was. It never accuses a
 * group of being slow on a hole it may simply not have entered yet within the
 * time allowed for it, and it reads the group's FURTHEST card, so one player
 * who enters every hole is enough to vouch for the four. A pace warning that
 * cries wolf gets switched off, and then it is not there the day it is right.
 *
 * TIME ALLOWED is per round, for eighteen holes played as a four-ball; three-
 * and two-balls are allowed proportionally less, which is how club pace
 * policies are written. The default is 4 hours 15 — the common club figure.
 *
 * The clock is the viewer's. Nothing here stores a time zone, and none is
 * needed: the committee reading this is at the course, so their device's local
 * time IS the course's, and a tee time of "8:10 AM" means 8:10 there. Callers
 * pass `now` so the whole thing is a pure function of its inputs.
 */

export const DEFAULT_PACE_MINUTES = 255;

/** Share of the four-ball time a smaller group is allowed. */
const SIZE_SHARE: Record<number, number> = { 1: 0.7, 2: 0.75, 3: 0.88, 4: 1 };

/** Behind by at least this many minutes is "out of position" — send someone. */
export const OUT_OF_POSITION = 10;

/** Minutes a hole for a group of this size, off an eighteen-hole four-ball target. */
export function minutesPerHole(paceMinutes: number, groupSize: number): number {
  const target = paceMinutes > 0 ? paceMinutes : DEFAULT_PACE_MINUTES;
  const share = SIZE_SHARE[Math.min(4, Math.max(1, groupSize))] ?? 1;
  return (target * share) / 18;
}

/** "4h 15m" */
export function hoursAndMinutes(minutes: number): string {
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/**
 * A tee time as written on the sheet — "8:10 AM", "8:10am", "14:30" — on the
 * round's day, in local time. Null when there is no time to read, which is a
 * group the committee simply has not timed rather than an error.
 */
export function teeInstant(playedOn: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(playedOn.trim());
  const t = /^(\d{1,2})[:.](\d{2})\s*([ap]\.?m\.?)?$/i.exec(time.trim());
  if (!d || !t) return null;
  let h = Number(t[1]);
  const min = Number(t[2]);
  const mer = t[3]?.toLowerCase().replace(/\./g, "");
  if (mer) {
    if (h < 1 || h > 12) return null;
    if (mer === "pm" && h !== 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
  }
  if (h > 23 || min > 59) return null;
  return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), h, min);
}

export interface PaceGroupIn {
  name: string;
  time: string;
  size: number;
  /** Holes the group's furthest card has a score on. */
  thru: number;
}

export type PaceState =
  | "not-started"
  | "on-pace"
  | "behind"
  | "out-of-position"
  | "finished"
  | "untimed"
  /** Well past its finishing time with holes still missing — the cards, not the pace, need chasing. */
  | "overdue"
  /** Out long enough to have played three holes and nothing entered — unmeasurable. */
  | "no-scores";

/** Holes' worth of time with no entry at all before a group is "not entering" rather than slow. */
export const NO_SCORES_AFTER_HOLES = 3;

/** Minutes past its due-in time before a group short of holes stops being measured as slow. */
export const OVERDUE_AFTER = 90;

export interface PaceRow {
  name: string;
  time: string;
  thru: number;
  state: PaceState;
  /** Whole minutes behind — zero unless `state` is behind or out-of-position. */
  behind: number;
  /** When the time allowed says it should be in, as an instant. Null if untimed. */
  dueIn: Date | null;
}

export function paceOfPlay(opts: {
  playedOn: string;
  holes: number;
  paceMinutes: number;
  groups: readonly PaceGroupIn[];
  now: Date;
}): PaceRow[] {
  const { playedOn, holes, paceMinutes, groups, now } = opts;
  return groups.map((g) => {
    const tee = teeInstant(playedOn, g.time);
    const base = { name: g.name, time: g.time, thru: g.thru };
    if (!tee) return { ...base, state: "untimed", behind: 0, dueIn: null };
    const perHole = minutesPerHole(paceMinutes, g.size);
    const dueIn = new Date(tee.getTime() + perHole * holes * 60_000);
    if (g.thru >= holes) return { ...base, state: "finished", behind: 0, dueIn };
    const elapsed = (now.getTime() - tee.getTime()) / 60_000;
    // Before the tee time AND nothing on the cards is a group waiting to go.
    // Holes on a card mean they are out there, whatever the sheet says — the
    // time was written wrong, or they went early — and "Off at 17:30" beside
    // "Thru 4" is the panel contradicting itself (walked 2026-09-29).
    if (elapsed < 0) {
      return g.thru > 0
        ? { ...base, state: "on-pace", behind: 0, dueIn }
        : { ...base, state: "not-started", behind: 0, dueIn };
    }
    // Long past its finishing time with cards still short is not slow play —
    // nobody is out there. It is cards not handed in, and saying "400 minutes
    // behind" at nine at night would bury the groups actually on the course.
    if (now.getTime() - dueIn.getTime() > OVERDUE_AFTER * 60_000) {
      return { ...base, state: "overdue", behind: 0, dueIn };
    }
    // Nothing on any card three holes in is a group not ENTERING, not a group
    // stuck on the 1st. It cannot be measured, and is said so rather than
    // priced at however long it has been since the tee time.
    if (g.thru === 0 && elapsed > NO_SCORES_AFTER_HOLES * perHole) {
      return { ...base, state: "no-scores", behind: 0, dueIn };
    }
    // The hole they are on should have been finished by (thru + 1) holes' time.
    const behind = Math.max(0, Math.floor(elapsed - (g.thru + 1) * perHole));
    const state: PaceState = behind >= OUT_OF_POSITION ? "out-of-position" : behind > 0 ? "behind" : "on-pace";
    return { ...base, state, behind, dueIn };
  });
}

/**
 * Holes a stored card has an entry on, wherever the group started — a shotgun
 * group off the 7th has holes 7 to 12 filled, not 1 to 6. Any stored number
 * counts, whatever it is: for pace, a hole with anything written against it
 * has been played.
 */
export function holesEntered(strokesJson: string): number {
  try {
    const raw = JSON.parse(strokesJson);
    return Array.isArray(raw) ? raw.filter((v) => typeof v === "number").length : 0;
  } catch {
    return 0;
  }
}
