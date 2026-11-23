import type { Family } from "./tournament-status";
import { generatesPairings, seededFromQualifiers } from "../stage-types";
import { needsTeams } from "../formats";

/**
 * WHICH SECTIONS DOES A ROUND'S "TEE TIMES & DRAW" SCREEN HAVE, AND IN WHAT ORDER (R9a).
 *
 * The TD's order of work (step 3 §2.2): who is in the round, the draw, tee times and the start, the
 * day's own setup (pins and pace), the paper. Pure: it chooses which sections are DRAWN and never what
 * is in them, so it holds no draw, cut or handicap arithmetic (`draw.ts` and `grouping.ts` are not
 * touched by this screen). The page asks it, the screen draws what it answers.
 *
 * R9a built the stroke and Stableford round; R9b builds every other round that is a sheet of groups or a
 * set of matches: a match, a round robin of flights, a league week, and a sided or head-to-head round
 * inside a stroke tournament. A knockout, flighted knockout or cup round is not built yet (R9c): the answer
 * says `built: false` and WHICH PR builds it (`lane`), and the page keeps drawing today's tee sheet for it,
 * unchanged. A casual round (`shape: match`) is in neither PR's list and stays on today's sheet. Whichever
 * PR lands next changes this function and nothing else decides, so a round is never drawn by two screens.
 *
 * WHAT THE DRAW SECTION HOLDS is the page's to fill, but WHICH CONTROLS a round's draw has is asked of
 * `drawControlsOf` below, so the Teams page, the Rounds link and this screen read one answer.
 */

export const DRAW_SECTION_KEYS = ["whoIn", "draw", "teeTimes", "onTheDay", "paper"] as const;
export type DrawSectionKey = (typeof DRAW_SECTION_KEYS)[number];

/** The words each section carries in its heading. */
export const DRAW_SECTION_TITLES: Readonly<Record<DrawSectionKey, string>> = {
  whoIn: "Who is in this round",
  draw: "The draw",
  teeTimes: "Tee times and start",
  onTheDay: "On the day",
  paper: "Paper",
};

export interface DrawRound {
  /** `Stage.type`. */
  type: string;
  /** `Stage.format`. */
  format: string;
  /** A sheet has been saved for the round (`parseTeeSheet`): without one there is no paper to print. */
  hasSavedSheet: boolean;
}

export type DrawSections =
  | { built: true; keys: readonly DrawSectionKey[] }
  | { built: false; lane: "R9b" | "R9c"; keys: readonly [] };

/** The families no screen of this one builds: a knockout, a flighted knockout and a cup are R9c's. */
const R9C_FAMILIES: readonly Family[] = ["knockout", "flightedKnockout", "teamCup"];

export function drawSections(round: DrawRound, family: Family): DrawSections {
  if (R9C_FAMILIES.includes(family)) return { built: false, lane: "R9c", keys: [] };
  // A casual round is in no PR's list: today's tee sheet draws it, as it always has.
  if (family === "casual") return { built: false, lane: "R9b", keys: [] };
  // Every other family is built, whatever the round is inside it: a stroke sheet, a match, a round robin
  // of flights, a league week, or a sided round of a stroke tournament. The sections are the same five, in
  // the TD's order; what the DRAW section holds is `drawControlsOf`'s.
  const keys: DrawSectionKey[] = ["whoIn", "draw", "teeTimes", "onTheDay"];
  if (round.hasSavedSheet) keys.push("paper");
  return { built: true, keys };
}

/**
 * WHICH DRAW CONTROLS A ROUND HAS (R9b), asked once by every screen that mounts one.
 *
 *  - `teamMatches`: the sides of the round are paired against each other ("Generate matches"): a round of
 *    sides that draws matches (`generatesPairings`), which is what `TeamsClient`'s `drawsMatches` always
 *    meant and `generateTeamMatches` refuses without.
 *  - `nextRound`: the round follows another and is drawn from its results ("Draw Round 2's matches", "Give
 *    out cards") once the tournament is live and not over: what Rounds & formats has always offered on the
 *    round's column, never on the first round or one seeded from qualifiers.
 */
export function drawControlsOf(
  round: { type: string; format: string },
  when: { launched: boolean; isFirst: boolean; completed: boolean },
): { teamMatches: boolean; nextRound: boolean } {
  return {
    teamMatches: needsTeams(round.format) && generatesPairings(round.type),
    nextRound: when.launched && !when.completed && !when.isFirst && !seededFromQualifiers(round.type),
  };
}

/**
 * WHERE "GENERATE MATCHES" IS DRAWN (R9b): Tee times & draw while that screen is shown AND builds this round,
 * Teams & pairs otherwise. ONE answer for both pages, so the control is on exactly one of them.
 */
export function matchGeneratorPlace(round: DrawRound, family: Family, teeTimesShown: boolean): "teeTimes" | "teams" {
  return teeTimesShown && drawSections(round, family).built ? "teeTimes" : "teams";
}

/**
 * WHICH SECTION IS MARKED "NEEDS YOU" (step 3 §2.2): when the tournament's one button (`tournamentJob`) is
 * this round's tee-sheet, draw or schedule job, so the screen says what the stepper and What's next say.
 * A job that belongs to another round marks nothing here. Publishing a sheet and making the draw are the
 * draw section's; the schedule is tee times.
 */
export function needsYouSection(
  job: { key: string; roundId: string | null } | null,
  roundId: string,
  keys: readonly DrawSectionKey[],
): DrawSectionKey | null {
  if (!job) return null;
  if (job.roundId !== null && job.roundId !== roundId) return null;
  const section: DrawSectionKey | null =
    job.key === "tee-sheet" || job.key === "draw" ? "draw" : job.key === "schedule" ? "teeTimes" : null;
  return section && keys.includes(section) ? section : null;
}
