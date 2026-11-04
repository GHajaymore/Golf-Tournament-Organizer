/**
 * ROUNDS & FORMATS, STEP 2 — "COURSE DAY" (behind `?view=timeline`, approved by Ajay 2 Nov).
 *
 * The facts the timeline shows beside each round, and the one list of what is still missing.
 * Everything here is read from what is STORED — the round, its course card and its saved tee
 * sheet — never from a guess about what the organizer will do next (the brief's rule 4: show the
 * effect before it happens, from stored settings only).
 *
 * Pure, so the server works it out once and the screen and its tests read the same answer.
 */

import type { TeeSheet } from "@/lib/domain/tee-sheet";

/** One round's golf facts, for its row on the spine and the top of its panel. */
export interface RoundFacts {
  /** The course this round is played on, or "" where none is named. */
  courseName: string;
  /** The card's pars for the holes this round plays (empty when the course has no card). */
  pars: number[];
  /** The course's tees with a rating, for the course card. */
  tees: Array<{ name: string; par: number; rating: number; slope: number }>;
  /** Players in the field for this round. */
  players: number;
  /** From the SAVED tee sheet only — a preview reshuffles on every visit. */
  groups: number;
  /** The largest group on the saved sheet (0 when there is none). */
  groupSize: number;
  firstTee: string;
  lastTee: string;
  /** tee | split | shotgun, as the sheet was saved. */
  startType: string;
  hasSheet: boolean;
}

/** What one saved sheet says, in the timeline's terms. */
export function sheetFacts(sheet: TeeSheet | null): Pick<RoundFacts, "groups" | "groupSize" | "firstTee" | "lastTee" | "startType" | "hasSheet"> {
  const groups = sheet?.groups.filter((g) => g.playerIds.length > 0) ?? [];
  if (!sheet || groups.length === 0) {
    return { groups: 0, groupSize: 0, firstTee: "", lastTee: "", startType: "", hasSheet: false };
  }
  const times = groups.map((g) => g.time.trim()).filter(Boolean);
  return {
    groups: groups.length,
    groupSize: Math.max(...groups.map((g) => g.playerIds.length)),
    firstTee: times[0] ?? "",
    lastTee: times.length > 1 ? times[times.length - 1] : "",
    startType: sheet.startType,
    hasSheet: true,
  };
}

/**
 * The pars a round plays: all eighteen, or the nine it names. A card with no pars gives none.
 * Mirrors `nine` as the round stores it (full | front | back).
 */
export function parsPlayed(pars: readonly number[], holes: number, nine: string): number[] {
  const real = pars.filter((p) => p > 0).length === pars.length ? [...pars] : [];
  if (real.length === 0) return [];
  if (holes !== 9 || real.length < 18) return real.slice(0, holes === 9 ? 9 : real.length);
  return nine === "back" ? real.slice(9, 18) : real.slice(0, 9);
}

/** What a round is missing, said with what it costs the players. */
export interface NeedItem {
  roundId: string;
  round: string;
  /** "has no date" — read after the round's name. */
  missing: string;
  /** In the player's terms (the UX writer, 2 Nov): "players cannot see when they play". */
  consequence: string;
  /** Where it is fixed: the round's own panel, or the tee sheet. */
  fix: "round" | "tee-sheet";
}

export interface NeedsInput {
  id: string;
  label: string;
  /** A round the field tees off in (a cut or a bracket has no card or tee sheet). */
  playing: boolean;
  /** Played, closed or carrying a result: nothing left to set up. */
  done: boolean;
  playedOn: string;
  courseName: string;
  hasCard: boolean;
  hasSheet: boolean;
}

/**
 * WHAT NEEDS YOU, IN THE ORDER IT IS DONE (Ajay, 2 Nov: "ease of using the configuration and
 * guided one"). Round by round, in play order, and inside a round in the order an organizer sets
 * it: where (a course with a card), when (a date), then who goes off when (tee times, which wait
 * for entries). The first item is the one next thing to do.
 */
export function roundNeeds(rounds: readonly NeedsInput[], entered: number): NeedItem[] {
  const out: NeedItem[] = [];
  for (const r of rounds) {
    if (!r.playing || r.done) continue;
    if (!r.courseName) {
      out.push({ roundId: r.id, round: r.label, missing: "has no course", consequence: "its cards cannot be scored", fix: "round" });
    } else if (!r.hasCard) {
      out.push({ roundId: r.id, round: r.label, missing: "has no course card", consequence: "its cards cannot be scored", fix: "round" });
    }
    if (!r.playedOn) {
      out.push({ roundId: r.id, round: r.label, missing: "has no date", consequence: "players cannot see when they play", fix: "round" });
    }
    if (entered > 0 && !r.hasSheet) {
      out.push({ roundId: r.id, round: r.label, missing: "has no tee times", consequence: "players cannot see when they start", fix: "tee-sheet" });
    }
  }
  return out;
}

/**
 * THE EFFECT, BEFORE IT HAPPENS (the brief's rule 4), from stored settings only:
 * "18 holes, net 95% → 48 players in 12 groups of 4 from 8:00 AM; last group off 9:50 AM."
 */
export function effectLine(input: {
  holes: number;
  /** "Net 95%", "Gross", "Off handicap" — the round's own words for how it is scored. */
  basis: string;
  facts: Pick<RoundFacts, "players" | "groups" | "groupSize" | "firstTee" | "lastTee" | "startType" | "hasSheet">;
}): { setting: string; outcome: string } {
  const { holes, basis, facts } = input;
  const setting = [`${holes} holes`, basis].filter(Boolean).join(", ");
  const players = `${facts.players} ${facts.players === 1 ? "player" : "players"}`;
  if (facts.players === 0) return { setting, outcome: "nobody entered yet" };
  if (!facts.hasSheet) return { setting, outcome: `${players}; no tee times yet` };
  const groups = `${facts.groups} ${facts.groups === 1 ? "group" : "groups"}${facts.groupSize ? ` of ${facts.groupSize}` : ""}`;
  const start =
    facts.startType === "shotgun"
      ? facts.firstTee ? `, shotgun at ${facts.firstTee}` : ", shotgun start"
      : facts.firstTee ? ` from ${facts.firstTee}` : "";
  const last = facts.startType !== "shotgun" && facts.lastTee ? `; last group off ${facts.lastTee}` : "";
  return { setting, outcome: `${players} in ${groups}${start}${last}` };
}
