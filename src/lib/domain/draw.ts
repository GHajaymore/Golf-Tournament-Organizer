/**
 * The draw: who plays together, in what order they go off, and from where.
 *
 * Three decisions that the tee sheet had collapsed into one. They are
 * genuinely independent, and conflating them is why a second round could not
 * be drawn properly:
 *
 *   1. Grouping    — who is in each group (see grouping.ts, plus byStandings
 *                    here, which is the one that needs a leaderboard).
 *   2. Draw order  — the order those groups go off the first tee.
 *   3. Start style — one tee, split tees, or a shotgun.
 *
 * Round one has no standings, so grouping is by handicap, seed or draw and the
 * order is arbitrary. From round two on, both change, and the conventions are
 * fixed enough to be worth encoding rather than leaving to a drag-and-drop:
 * you play with the people nearest you on the board, and the leaders go off
 * last. Getting that wrong is not a cosmetic problem — it decides who plays in
 * front of the crowd and who finishes in the dark.
 */

import type { Group, Player } from "./types";

/** Where a player stands, 1 = leading. */
export interface Standing {
  playerId: string;
  /** Leaderboard position. Ties share a position, as on a real board. */
  position: number;
}

export type DrawOrder = "as-formed" | "leaders-last" | "leaders-first" | "random";

export type StartStyle = "tee" | "split" | "shotgun";

export interface DrawOrderInfo {
  key: DrawOrder;
  label: string;
  blurb: string;
  /** Whether this order is meaningless without a leaderboard. */
  needsStandings: boolean;
}

export const DRAW_ORDERS: DrawOrderInfo[] = [
  {
    key: "leaders-last",
    label: "Leaders out last",
    blurb:
      "The standard final-round draw. The last group on the tee is the last group on the green, so the tournament finishes where the lead is.",
    needsStandings: true,
  },
  {
    key: "leaders-first",
    label: "Leaders out first",
    blurb:
      "Leaders away early. Used when weather is coming, or when the prizegiving needs the contenders in before the field.",
    needsStandings: true,
  },
  {
    key: "as-formed",
    label: "As grouped",
    blurb: "Keep the order the groups came out in. Sensible for a first round, where there is nothing to seed off.",
    needsStandings: false,
  },
  {
    key: "random",
    label: "Random draw",
    blurb: "Shuffle the running order. Nobody can claim the sheet was arranged.",
    needsStandings: false,
  },
];

/** A position lookup that puts anyone unranked at the back. */
export function positionLookup(standings: Standing[]): (playerId: string) => number {
  const map = new Map(standings.map((s) => [s.playerId, s.position]));
  // Someone who missed the first round has no position. They cannot be given
  // 0 — that would draw them out with the leaders.
  return (id) => map.get(id) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * A group's place in the draw is its best-placed player.
 *
 * This is the convention on every tour sheet: a group containing the leader is
 * the leading group, whoever else is in it.
 */
export function groupPosition(group: Group, positionOf: (playerId: string) => number): number {
  if (group.playerIds.length === 0) return Number.MAX_SAFE_INTEGER;
  return Math.min(...group.playerIds.map(positionOf));
}

/**
 * Put the groups in their running order.
 *
 * Sorting is stable on the incoming order, so groups level on position stay in
 * the sequence the grouping produced rather than being reshuffled on every
 * render.
 */
export function orderGroups(
  groups: Group[],
  order: DrawOrder,
  positionOf: (playerId: string) => number = () => Number.MAX_SAFE_INTEGER,
  rng: () => number = Math.random,
): Group[] {
  const out = [...groups];

  if (order === "as-formed") return out;

  if (order === "random") {
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  const decorated = out.map((g, i) => ({ g, i, pos: groupPosition(g, positionOf) }));
  decorated.sort((a, b) => (a.pos === b.pos ? a.i - b.i : a.pos - b.pos));
  // leaders-last is the same sort read backwards, but reversing the array
  // would also reverse the tiebreak. Sorting descending keeps ties in their
  // original order either way.
  if (order === "leaders-last") {
    decorated.sort((a, b) => (a.pos === b.pos ? a.i - b.i : b.pos - a.pos));
  }
  return decorated.map((d) => d.g);
}

/**
 * Group the field by leaderboard position — you play with the players nearest
 * you on the board.
 *
 * Deliberately not part of formGroups: every rule there works off attributes a
 * player carries with them, and this one needs a round to have been played.
 * Folding it in would mean every caller had to supply standings it may not
 * have.
 */
export function groupByStandings(
  players: Player[],
  positionOf: (playerId: string) => number,
  size: number,
  makeId: (index: number) => string = (i) => `group-${i}`,
): Group[] {
  const per = Math.max(2, Math.round(size));
  const ordered = players
    .map((p, i) => ({ p, i, pos: positionOf(p.id) }))
    .sort((a, b) => (a.pos === b.pos ? a.i - b.i : a.pos - b.pos))
    .map((d) => d.p);

  const groups: Group[] = [];
  for (let i = 0; i < ordered.length; i += per) {
    const chunk = ordered.slice(i, i + per);
    groups.push({
      id: makeId(groups.length),
      name: `Group ${groups.length + 1}`,
      playerIds: chunk.map((p) => p.id),
    });
  }

  // A trailing single cannot play alone. The convention is to fold them into
  // the group in front rather than send out a one-ball.
  if (groups.length > 1 && groups[groups.length - 1].playerIds.length === 1) {
    const last = groups.pop()!;
    groups[groups.length - 1].playerIds.push(...last.playerIds);
  }

  return groups;
}

export interface StartSlot {
  groupId: string;
  /** Display time, e.g. "8:10 AM". Empty for a shotgun, which has one time. */
  time: string;
  /** The hole this group starts on. */
  startHole: number;
  /** Shotgun only, and only when the field outgrows the course: "A" or "B". */
  half?: "A" | "B";
}

/** Add `mins` to an "HH:MM" clock time, returning "H:MM AM/PM". */
export function addMinutes(clock: string, mins: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  const base = m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 8 * 60;
  const t = (((base + mins) % (24 * 60)) + 24 * 60) % (24 * 60);
  let h = Math.floor(t / 60);
  const mm = String(t % 60).padStart(2, "0");
  const ap = h < 12 ? "AM" : "PM";
  h = h % 12 || 12;
  return `${h}:${mm} ${ap}`;
}

/**
 * Hand each group a time and a starting hole.
 *
 * The groups arrive already in draw order, so this only decides the clock and
 * the tee — the two are coupled, which is the whole reason they are worked out
 * together:
 *
 *  - tee:     one group every interval off the 1st.
 *  - split:   two groups every interval, off the 1st and the 10th. Halves the
 *             time to get a field away, which is why most club events use it.
 *  - shotgun: everyone starts at once, one group per hole. Past the course's
 *             hole count groups double up as 1A/1B — a real and common
 *             arrangement, not an error.
 */
export function startSlots(
  groups: Group[],
  style: StartStyle,
  opts: { firstTee?: string; interval?: number; holes?: number } = {},
): StartSlot[] {
  const firstTee = opts.firstTee ?? "08:00";
  const interval = Math.max(1, opts.interval ?? 10);
  const holes = opts.holes === 9 ? 9 : 18;

  if (style === "shotgun") {
    return groups.map((g, i) => {
      const startHole = (i % holes) + 1;
      const wave = Math.floor(i / holes);
      return {
        groupId: g.id,
        time: addMinutes(firstTee, 0),
        startHole,
        ...(groups.length > holes ? { half: (wave === 0 ? "A" : "B") as "A" | "B" } : {}),
      };
    });
  }

  if (style === "split") {
    // A nine-hole course has no 10th tee, so a split there is off 1 and 5 —
    // the nearest thing to halfway round.
    const secondTee = holes === 9 ? 5 : 10;
    return groups.map((g, i) => ({
      groupId: g.id,
      time: addMinutes(firstTee, Math.floor(i / 2) * interval),
      startHole: i % 2 === 0 ? 1 : secondTee,
    }));
  }

  return groups.map((g, i) => ({
    groupId: g.id,
    time: addMinutes(firstTee, i * interval),
    startHole: 1,
  }));
}
