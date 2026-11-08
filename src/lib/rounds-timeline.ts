/**
 * ROUNDS & FORMATS, STEP 2 — "COURSE DAY" (behind `?view=timeline`, approved by Ajay 2 Nov).
 *
 * The GOLF facts the timeline shows beside each round: its course card, its field, its saved tee
 * times, and the effect of its settings. Everything here is read from what is STORED — the round,
 * its course card and its saved tee sheet — never from a guess about what the organizer will do
 * next (the brief's rule 4: show the effect before it happens, from stored settings only).
 *
 * WHERE THE TOURNAMENT IS — its step, what needs the organizer, each round's state — is NOT here.
 * It was (`roundNeeds`, with rules of its own for a course, a date and tee times: D7), and is now
 * the state machine's alone, read through `courseDayOf` (domain/timeline-step.ts; PR 5c, J16).
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
