import { standingsUnit } from "../format-chain";
import { isKnockoutRound } from "../stage-types";
import { matchKeptBy } from "./match-kept-by";
import { isStablefordRound } from "./week-basis";

/** What a round's close section talks about: strokes and places, points, or matches (B113). */
export type ClosingKind = "stroke" | "points" | "match";

/**
 * WHICH WORDS A ROUND'S CLOSE SECTION SPEAKS — decided from how the round is PLAYED, never from the format's engine.
 * Four-Ball's engine is `team-aggregate`, which `standingsUnit` calls "strokes", but a four-ball cup session is a set of
 * matches with no scorecard and no place, tapped or kept on cards (B113). `matchKeptBy` is the one answer to "is this
 * round played as matches" (a medal four-ball is not: it answers null and keeps the stroke words).
 */
export function closingKind(stage: {
  type: string;
  format: string;
  scoringBasis: string;
  scoreInput: string | null;
  matchKeptBy: string | null;
}): ClosingKind {
  // A knockout is match play too, but `matchKeptBy` answers null for it (its draw files a winner per tie, nobody keeps a
  // match), so it is asked here. Its close words are never drawn (`closingTickShown` is false for a bracket); its scoring
  // window is, and must not wait for a card (B132).
  if (isKnockoutRound(stage.type) || matchKeptBy(stage) !== null) return "match";
  return isStablefordRound(stage.scoringBasis, stage.format) ? "points" : "stroke";
}

/** The match round's folded line: how many of its matches are over (`storedMatchIsOver`, counted by the caller). */
export function matchesState(closed: boolean, finished: number, total: number, round: string): string {
  if (closed) return `${round} is closed`;
  if (total === 0) return "Open";
  if (finished >= total) return total === 1 ? "The match is finished" : `All ${total} matches finished`;
  return `${finished} of ${total} ${total === 1 ? "match" : "matches"} finished`;
}

/**
 * WHAT THE SCORING WINDOW SAYS ABOUT STAYING OPEN (B132): the sentence under the window's three buttons names what is
 * still to come in. A card round waits for its last card; a match round has no card, so it waits for its last match to
 * be finished (`matchesState`'s own word). One place, so the control never retypes it.
 */
export function windowWords(kind: ClosingKind): { extended: string; keptOpen: string } {
  const last = kind === "match" ? "the last match is finished" : "the last card is in";
  return {
    extended: `Scores are still being accepted even though the date has passed. Set it back to follow the date once ${last}.`,
    keptOpen: `Scoring will stay open after the Play by date passes. Set it back to follow the date once ${last}.`,
  };
}

/**
 * Whether a round has the "This round is finished" tick at all: not a bracket, and not a round of match points, where
 * there is no place for closing to take (the question `RoundOnTheDay` has always asked, said once for both screens).
 */
export function closingTickShown(stage: { type: string; format: string; scoringBasis: string }): boolean {
  return stage.type !== "Bracket Stage" && standingsUnit(stage.format, stage.scoringBasis) !== "match points";
}

/**
 * WHAT CLOSING A ROUND SAYS ABOUT ITSELF (R12), in one place with no directive so the old Rounds screen, the redesigned
 * Score entry and a test all read the same words.
 *
 * `whole` is the paragraph the tick has always carried (the old screen draws it as it is). `short` is the line the
 * redesigned Score entry keeps beside the tick, with `whole` one tap away behind its ⓘ: the ⓘ holds the explanation,
 * never the instruction (`FieldInfo`), and the line beside the tick still says what the tick is for.
 */
export function closingWords(kind: ClosingKind): { short: string; whole: string; closedNote: string | null } {
  if (kind === "match") {
    // A match has no scorecard and no place (Rule 3.2a; Rule 23 for four-ball): it is decided on holes won, and an
    // unfinished one is the committee's to settle (Committee Procedures, terms of the competition). No word "card" or
    // "place" belongs here, and nothing is said about taps after the close: that is not decided (B113 side finding A).
    return {
      short: "Tell the board this round's matches are over.",
      whole:
        "Tell the board this round's matches are over, which makes its results official. A match that isn't finished keeps the holes it has, and the committee decides it. Leave it unticked while matches are still on the course.",
      closedNote: "Closed. Untick it to correct a match — nothing is lost either way.",
    };
  }
  const pointsBoard = kind === "points";
  return pointsBoard
    ? {
        closedNote: null,
        short: "Marks the round as played.",
        // A missed week already costs a points player the points it was
        // worth, so nothing about the board changes here. Saying so is
        // better than a control whose effect is invisible.
        whole:
          "Marks the round as played. On a points round this changes nobody's position — a missed round already costs the points it was worth.",
      }
    : {
        closedNote: "Closed. Untick it to take a late card or correct one — nothing is lost either way.",
        short: "Tell the board the round is over.",
        whole:
          "Tell the board the round is over, which makes its result official — the public board reads Final rather than All in. Anybody without a complete card for it is then shown without a place, the same as a card that stopped short — they have not completed the competition. Leave it unticked while cards are still coming in.",
      };
}
