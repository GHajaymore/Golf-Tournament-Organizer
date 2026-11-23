import { standingsUnit } from "../format-chain";

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
export function closingWords(pointsBoard: boolean): { short: string; whole: string } {
  return pointsBoard
    ? {
        short: "Marks the round as played.",
        // A missed week already costs a points player the points it was
        // worth, so nothing about the board changes here. Saying so is
        // better than a control whose effect is invisible.
        whole:
          "Marks the round as played. On a points round this changes nobody's position — a missed round already costs the points it was worth.",
      }
    : {
        short: "Tell the board the round is over.",
        whole:
          "Tell the board the round is over, which makes its result official — the public board reads Final rather than All in. Anybody without a complete card for it is then shown without a place, the same as a card that stopped short — they have not completed the competition. Leave it unticked while cards are still coming in.",
      };
}
