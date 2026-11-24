import type { GuideVariant } from "./index";

/**
 * THE GUIDE'S WORDS FOR WINNERS & MONEY, THE SETTLE HALF (R8b), drawn only while the screen is shown.
 *
 * It replaces nothing: today's guide (Part 8, prizes and payouts) stays true until the screens go on. What was OFFERED, before
 * play, is said in the Prizes & side games variant (`prizes.ts`); this says what is RECORDED once the result is final.
 */
export const MONEY_GUIDE: GuideVariant = {
  screen: "money",
  replaces: [],
  sections: [
    {
      id: "winnersmoney",
      part: "Part 8",
      title: "Winners & money",
      blocks: [
        { kind: "where", text: "This event → Winners & money" },
        {
          kind: "p",
          text: "**TourneyHQ works out and records who is owed what. It does not pay anyone.** This screen is where results are recorded and settled: who won each prize, the season's skins, the kitty or the ledger, and the side games of one group. Amounts that can still change appear once they are final. What you offered, before play, is on Prizes & side games.",
        },
        {
          kind: "steps",
          items: [
            "Under **Prizes**, pick the winner of each line from its list. The list opens on the finishing order, so the top of the board is first. **Awarded** at the top counts the lines that have a winner, and picking **Not awarded** takes an award back. With **One prize per player** on, a player who already holds a placing prize is listed last and says which they hold.",
            "A tournament that keeps a **kitty** records each amount: press [[Money in]] or [[Money out]], say what it was for, type the amount and press [[Record money in]] or [[Record money out]]. A tournament that splits shared costs shows **The ledger**, and [[Mark settled]] records a payment between two people.",
            "**Groups' side games** at the foot are the games of one group, or of whoever wants in wherever they play. The group's pot is theirs; it is kept apart from the field's.",
            "**Pots and contests** says how far the field's games have got, such as 2 of 3 contests have a winner and 5 of 12 stakes paid, and links to them. Who is in each pot, who has paid their stake and who won a closest-to-the-pin or long drive are kept on that game's own card on Prizes & side games, so a pot is one card, not two.",
          ],
        },
        {
          kind: "p",
          text: "A figure that can still change, such as a birdie pot, low gross or low net, is not shown while a round is live; it appears when it is final. Recording a winner, the kitty or a payment is never locked, so a completed tournament can still be settled; what was offered is shut until [[Reopen tournament]].",
        },
      ],
    },
  ],
};
