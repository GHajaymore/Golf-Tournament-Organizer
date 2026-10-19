/**
 * HOW A ROUND'S MATCHES ARE KEPT — tap who won each hole, or stroke cards.
 *
 * Ajay, 2026-10-19, after the first real cup: "provide both options for
 * organizer to decide while setting up the tournament." The cup was kept by
 * tapping who won each hole, and the players praised it; a stroke card gives
 * gross and net, works the strokes out for them and counts for handicapping.
 * Both are good. What is NOT good is both on one match: a stroke card rebuilds
 * the match from strokes, over holes somebody tapped, and the tapped holes
 * leave card rows behind that the next card save rebuilds from. So a round is
 * kept ONE way, and every surface — the round-code card, the player app, the
 * console's Score entry and the server — asks this function which.
 *
 * Pure, and the only reader of `Stage.matchKeptBy`.
 */
import { isHeadToHead, isKnockoutRound } from "@/lib/stage-types";
import { findFormat, inputChoices, resolveScoreInput } from "@/lib/formats";
import { isCupSession } from "@/lib/domain/cup-lineup";

export type MatchKeptBy = "holes" | "cards";

export const MATCH_KEPT_BY: Array<{ key: MatchKeptBy; label: string; detail: string }> = [
  {
    key: "holes",
    label: "Tap who won each hole",
    detail:
      "One tap a hole, on any phone. Quick and simple; players give their own shots, which the card shows. No stroke totals, so nothing for handicapping.",
  },
  {
    key: "cards",
    label: "Stroke cards",
    detail:
      "Every player enters their strokes and the app works out each hole, shots included. Gross and net are published.",
  },
];

/** A round whose format already carries this choice in "How scores are recorded". */
export function keptByScoreInput(format: string): boolean {
  return inputChoices(format).includes("hole-results");
}

/**
 * How this round's matches are kept, or null for a round with no matches.
 *
 * - Match Play and Nassau answer from `scoreInput`, which already holds the
 *   choice for them ("Who won each hole" / "Every stroke"): one control per
 *   round, never two that could disagree.
 * - Otherwise what the organizer chose, when they chose one.
 * - Otherwise a cup session is tapped — the card the cup was played on — and
 *   any other team match is kept on cards, which is how Score entry has
 *   always taken it (a league's secretary types the four-ball cards in).
 *
 * A stored string the app does not know is read as "not chosen": a
 * `"use server"` export takes whatever it is sent.
 */
export function matchKeptBy(stage: {
  type: string;
  format: string;
  // Both REQUIRED: a reader that forgot to select one would answer for a
  // different round than the one on the screen.
  scoreInput: string | null;
  matchKeptBy: string | null;
}): MatchKeptBy | null {
  // A Nassau files Match rows on a round typed as stroke play.
  if (!isHeadToHead(stage.type) && findFormat(stage.format).engine !== "nassau") return null;
  // A knockout's draw files a winner per tie, not a match anybody keeps.
  if (isKnockoutRound(stage.type)) return null;
  if (keptByScoreInput(stage.format)) {
    return resolveScoreInput(stage.format, stage.scoreInput) === "gross-cards" ? "cards" : "holes";
  }
  const chosen = (stage.matchKeptBy ?? "").trim();
  if (chosen === "holes" || chosen === "cards") return chosen;
  return isCupSession(stage) ? "holes" : "cards";
}

/** Said when a tap reaches a round kept on cards. */
export const KEPT_ON_CARDS =
  "This round's matches are kept on stroke cards, so enter your strokes on your card — the app works out who won each hole.";

/** Said when a stroke card reaches a round kept by tapping. */
export const KEPT_BY_HOLES =
  "This round's matches are kept by tapping who won each hole, so there's no stroke card to save. The organizer can change that on Rounds & formats.";
