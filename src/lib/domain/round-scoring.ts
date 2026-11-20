/**
 * WHO KEEPS A ROUND'S CARD, AND WHO CHECKS IT (2026-11-04, sprint 2 part B).
 *
 * At a real team cup (2026-10-18) round-code scorers tapped an opponent's name
 * on /play, every phone in a four-ball could write the match, and a board
 * showed results the wrong way round. Ajay approved two per-round settings:
 *
 *   Who enters scores    one scorer per group (`group`), each player their own
 *                        (`each` — every round before this existed), or the
 *                        organizer from paper cards (`organizer`).
 *   End-of-round check   on: the other side confirms a match result, each
 *                        player confirms their own card in stroke play, and a
 *                        disputed one is held off the board; off: as before.
 *
 * THE ONE READER of `Stage.scoreKeeping` and `Stage.endCheck`. A stored value
 * the app does not know reads as the column's default — the round behaves as it
 * did before the setting existed — the way `matchKeptBy` reads an unknown
 * value as "not chosen". A `"use server"` export is called with whatever the
 * caller likes, so the column can hold anything.
 *
 * Pure.
 */
import { signsCards } from "@/lib/tournament-shape";

export type ScoreKeeping = "group" | "each" | "organizer";
export type EndCheck = "on" | "off";

export interface RoundScoring {
  scoreKeeping: ScoreKeeping;
  endCheck: EndCheck;
}

/** The choices, in a golfer's words, US first and sentence case. */
export const SCORE_KEEPING: Array<{ key: ScoreKeeping; label: string; detail: string }> = [
  {
    key: "group",
    label: "One scorer per group",
    detail:
      "One player in each group keeps the group's card on their phone. Anyone in the group can take over, and the change is logged.",
  },
  {
    key: "each",
    label: "Each player enters their own",
    detail: "Every player enters their own score (or their own side's match) on their own phone.",
  },
  {
    key: "organizer",
    label: "Organizer only (paper cards)",
    detail: "Players hand in paper cards and the organizer enters them. Players can't enter scores for this round.",
  },
];

/** The end-of-round check's two choices; the "on" words depend on the round's kind. */
export function endCheckLabel(check: EndCheck, matchPlay: boolean): string {
  if (check === "off") return "Off";
  return matchPlay ? "The other side confirms" : "Each player confirms their own card";
}

export function isScoreKeeping(v: unknown): v is ScoreKeeping {
  return v === "group" || v === "each" || v === "organizer";
}

export function isEndCheck(v: unknown): v is EndCheck {
  return v === "on" || v === "off";
}

/**
 * How this round is kept and checked. Both fields REQUIRED on the argument: a
 * reader that forgot to select one would answer for a different round than the
 * one on the screen.
 */
export function roundScoring(stage: { scoreKeeping: string | null; endCheck: string | null }): RoundScoring {
  const keeping = (stage.scoreKeeping ?? "").trim();
  const check = (stage.endCheck ?? "").trim();
  return {
    scoreKeeping: isScoreKeeping(keeping) ? keeping : "each",
    endCheck: isEndCheck(check) ? check : "off",
  };
}

/**
 * WHAT A NEW ROUND STARTS WITH: one scorer per group, and the end-of-round
 * check on for a tournament — off for a casual round, which signs nothing
 * (`signsCards`: "no certification for casual card", Ajay 2026-10-07).
 *
 * Every place a Stage is created spreads this (`every-stage-create-says-its-
 * scoring.test.ts` holds them to it); the column defaults are for rounds that
 * existed before, which keep today's behaviour.
 */
export function scoringDefaults(shape: string | null | undefined): RoundScoring {
  return { scoreKeeping: "group", endCheck: signsCards(shape) ? "on" : "off" };
}

/**
 * WHETHER A PLAYER MAY ENTER SCORES ON THIS ROUND — the one gate.
 *
 * The tournament's "staff" setting (`scoreEntryBy`) always wins: a committee-
 * scored tournament refuses every player whatever a round says. Then the round
 * itself: "Organizer only (paper cards)" refuses players on that round alone.
 *
 * `stage` is REQUIRED (null only where no round is in question — a
 * tournament-wide screen), so the day this rule grows the compiler lists every
 * caller. A bare `canEnterScores(settings, "player")` asked the tournament and
 * never the round; `every-score-gate-asks-the-round.test.ts` refuses one.
 */
export function playersMayEnter(
  settings: { scoreEntryBy: string },
  stage: { scoreKeeping: string | null; endCheck: string | null } | null,
): boolean {
  return playerEntryRefusal(settings, stage) === null;
}

/** Said to a player when the tournament's committee enters every score. */
export const ORGANIZER_KEEPS_THIS_TOURNAMENT = "Scores for this tournament are entered by the organizer.";

/** Said to a player on a round the organizer keeps from paper cards. */
export const ORGANIZER_KEEPS_THIS_ROUND =
  "The organizer enters this round's scores from paper cards, so there's nothing to enter here.";

/** The same gate, as the sentence a refused player reads — or null when they may enter. */
export function playerEntryRefusal(
  settings: { scoreEntryBy: string },
  stage: { scoreKeeping: string | null; endCheck: string | null } | null,
): string | null {
  if (settings.scoreEntryBy !== "players") return ORGANIZER_KEEPS_THIS_TOURNAMENT;
  if (stage && roundScoring(stage).scoreKeeping === "organizer") return ORGANIZER_KEEPS_THIS_ROUND;
  return null;
}

/**
 * The same gate for somebody whose ROLE is in question: staff always enter
 * (entering the field's cards is their job, paper cards included); a player
 * goes through `playerEntryRefusal`. The sentence, or null when they may.
 */
export function entryRefusalFor(
  settings: { scoreEntryBy: string },
  role: string,
  stage: { scoreKeeping: string | null; endCheck: string | null } | null,
): string | null {
  if (role === "admin" || role === "assistant") return null;
  return playerEntryRefusal(settings, stage);
}

/** The one line on a round card, e.g. "One scorer per group · other side confirms". */
export function scoringSummary(scoring: RoundScoring, matchPlay: boolean): string {
  const who = SCORE_KEEPING.find((s) => s.key === scoring.scoreKeeping)?.label ?? "";
  if (scoring.endCheck === "off") return `${who} · no end-of-round check`;
  return `${who} · ${matchPlay ? "other side confirms" : "each player confirms their card"}`;
}
