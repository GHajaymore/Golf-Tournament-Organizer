import type { Family } from "./tournament-status";
import { roundIsStroke } from "../stage-types";

/**
 * WHICH SECTIONS DOES A ROUND'S "TEE TIMES & DRAW" SCREEN HAVE, AND IN WHAT ORDER (R9a).
 *
 * The TD's order of work (step 3 §2.2): who is in the round, the draw, tee times and the start, the
 * day's own setup (pins and pace), the paper. Pure: it chooses which sections are DRAWN and never what
 * is in them, so it holds no draw, cut or handicap arithmetic (`draw.ts` and `grouping.ts` are not
 * touched by this screen). The page asks it, the screen draws what it answers.
 *
 * R9a builds the stroke and Stableford round. A match, team, league, knockout or cup round is not built
 * yet: the answer says `built: false` and WHICH PR builds it (`lane`), and the page keeps drawing
 * today's tee sheet for it, unchanged. When R9b / R9c land they change this function and nothing else
 * decides, so a round is never drawn by two screens.
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

/** The PR that builds each family's screen. Stroke and Stableford are this one. */
function laneOf(family: Family): "R9b" | "R9c" {
  switch (family) {
    case "knockout":
    case "flightedKnockout":
    case "teamCup":
      return "R9c";
    default:
      return "R9b";
  }
}

export function drawSections(round: DrawRound, family: Family): DrawSections {
  const strokeFamily = family === "stroke" || family === "stableford";
  // A round whose pairings are the draw (a match, a head-to-head side format) is not a stroke sheet,
  // whatever the tournament's family says.
  if (!strokeFamily || !roundIsStroke(round.type, round.format)) {
    return { built: false, lane: laneOf(family), keys: [] };
  }
  const keys: DrawSectionKey[] = ["whoIn", "draw", "teeTimes", "onTheDay"];
  if (round.hasSavedSheet) keys.push("paper");
  return { built: true, keys };
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
