import type { Family } from "./tournament-status";
import { generatesPairings, isKnockoutRound, seededFromQualifiers } from "../stage-types";
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
 * inside a stroke tournament; R9c builds the knockout, the knockout in flights and the cup, whose set-up
 * (the flights, the play-off for third, the play-by dates, a session's lineup) moves here from the Bracket and
 * the Team cup. A casual round (`shape: match`) is in no PR's list and stays on today's sheet (`built: false`),
 * unchanged. This function and nothing else decides, so a round is never drawn by two screens.
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
  | { built: false; lane: "none"; keys: readonly [] };

export function drawSections(round: DrawRound, family: Family): DrawSections {
  // A casual round is in no PR's list: today's tee sheet draws it, as it always has.
  if (family === "casual") return { built: false, lane: "none", keys: [] };
  // Every other family is built, whatever the round is inside it: a stroke sheet, a match, a round robin
  // of flights, a league week, a sided round of a stroke tournament, and (R9c) a knockout, a knockout in
  // flights and a cup. The sections are the same five, in the TD's order; what the DRAW section holds is
  // `drawControlsOf`'s and `knockoutSetupOf`'s.
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
 * WHICH SET-UP CONTROLS A KNOCKOUT OR CUP ROUND HAS ON THIS SCREEN (R9c), asked once by every screen that mounts one.
 *
 *  - `thirdPlace`: the play-off for third place, on the bracket's own round (`isKnockoutRound`). It left Rounds & formats
 *    with the draw (R4d hides it once the draw's door moves), so it must be here or it is nowhere.
 *  - `playBy`: the play-by dates of the bracket's rounds, set once, here (phase 1 row 27).
 *  - `flights`: the division of a knockout in flights, which IS its draw (`bracketMode: "flights"`).
 *  - `lineup`: a cup session's lineup, on the session's own round (`TEAM_SESSION` is the stage type of a session).
 *
 * `bracketMode` is the event's (`Event.bracketMode`); only the value "flights" asks for the flights panel. `isFirstKnockout` is whether
 * this is the event's first bracket round, as the Bracket computes it (`findIndex(isKnockoutRound)`).
 */
export function knockoutSetupOf(
  round: { type: string },
  bracketMode: string,
  isFirstKnockout: boolean,
): { thirdPlace: boolean; playBy: boolean; flights: boolean; lineup: boolean } {
  const bracket = isKnockoutRound(round.type);
  // The knockout is ONE ladder (Golf Pro, 23 Nov): its play-by dates and its flights are the event's, kept on the FIRST bracket round (the
  // one the Bracket reads), so they are drawn there once. The play-off for third stays per round, as Rounds & formats had it.
  const ladder = bracket && isFirstKnockout;
  return { thirdPlace: bracket, playBy: ladder, flights: ladder && bracketMode === "flights", lineup: round.type === "Team Session" };
}

/**
 * WHERE THE KNOCKOUT'S SET-UP IS DRAWN (R9c): Tee times & draw while that screen is shown AND builds the round, the Bracket
 * (and Rounds & formats, for the play-off for third) otherwise. ONE answer for the Bracket page and this screen, so each control
 * is on exactly one of them. `matchGeneratorPlace` is the same rule for the match generator.
 */
export function knockoutSetupPlace(round: DrawRound, family: Family, teeTimesShown: boolean): "teeTimes" | "bracket" {
  return teeTimesShown && drawSections(round, family).built ? "teeTimes" : "bracket";
}

/** WHERE A CUP SESSION'S LINEUP IS DRAWN (R9c): the same rule for the Team cup page, which then says where it went. */
export function cupLineupPlace(round: DrawRound, family: Family, teeTimesShown: boolean): "teeTimes" | "cup" {
  return teeTimesShown && drawSections(round, family).built ? "teeTimes" : "cup";
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
