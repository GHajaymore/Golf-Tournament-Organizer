/**
 * THE TWO HALVES OF A TOURNAMENT'S MONEY, AND WHERE A FIELD'S GAMES ARE OFFERED (R8a).
 *
 * Money is split by WHEN (step 3 §4): what is OFFERED is set up before play on Prizes & side games, and what is
 * SETTLED (who has paid, who won, the kitty, the costs, settling up) is done once the result is final on Winners & money
 * (R8b). A control is in exactly ONE part; a control in both is a second copy, and a control in neither is one nobody
 * can reach. The part is the lock's own split (`docs/claude/lock-scopes.md`): the offer asks the `money` scope and
 * is shut at completion; the settle side never locks.
 *
 * A "control" is named by the server action it presses, so the split is held to the actions themselves
 * (`money-parts.test.ts` reads them). TourneyHQ works money out and records it. It never moves it.
 *
 * NOT `partOf`: `domain/field-change.ts` already exports one for field changes. NOT in `money-layout.ts`: that file is
 * arithmetic, and this is only a list of where controls are drawn. Final-only stays at the sink (`gameNets`).
 */

export type MoneyPart = "offer" | "settle";

/** What is set up before play: the prize table, the one-prize rule, a pot's or contest's definition, the money mode. */
export const OFFER_CONTROLS = [
  "addPrize",
  "updatePrize",
  "removePrize",
  "applyPrizeStructure",
  "setOnePrizePerPlayer",
  "setPrizeCounts",
  "addContest",
  "removeContest",
  // A contest's sponsor is named with the contest, on the screen that offers it.
  "setContestSponsor",
  "saveSkinsPot",
  "removeSkinsPot",
  "saveSideGame",
  "removeSideGame",
  "setEventMoneyMode",
  "setPotEntryMode",
] as const;

/** What is done once the result is final: winners, who has paid, the kitty, the costs, settling up. */
export const SETTLE_CONTROLS = [
  "setPrizeWinner",
  "setContestEntrants",
  "requestContestEntry",
  "confirmContestEntry",
  "setContestWinners",
  // Changing who is in a pot that exists is the ledger's; naming the entrants of a pot that does not exist yet is the offer's
  // and is asked by the action (docs/claude/lock-scopes.md), not drawn as a control of its own.
  "setSkinsEntrants",
  "requestSkinsEntry",
  "confirmSkinsEntry",
  "setSideGameEntrants",
  "requestSideGameEntry",
  "confirmSideGameEntry",
  "setPotExcluded",
  "setExpenseEntry",
  "addFundLine",
  "removeFundLine",
  "addExpense",
  "updateExpense",
  "removeExpense",
  "recordSettlement",
  "removeSettlement",
  // A bet's name is a label on the ledger's lines; it is renamed where the groups' games are kept.
  "renameBet",
] as const;

export type MoneyControl = (typeof OFFER_CONTROLS)[number] | (typeof SETTLE_CONTROLS)[number];

/**
 * Which part a control is drawn in. Throws for a name in neither or in both lists: a screen that asks about a control
 * nobody placed has found a hole, and silence here would be a control drawn twice or not at all.
 */
export function moneyPartOf(control: string): MoneyPart {
  const broken = moneyPartProblems(OFFER_CONTROLS, SETTLE_CONTROLS);
  if (broken.length > 0) throw new Error(`the money parts are inconsistent: ${broken.join("; ")}`);
  const offer = (OFFER_CONTROLS as readonly string[]).includes(control);
  const settle = (SETTLE_CONTROLS as readonly string[]).includes(control);
  if (offer && settle) throw new Error(`the money control ${control} is in both parts`);
  if (offer) return "offer";
  if (settle) return "settle";
  throw new Error(`the money control ${control} is in no part`);
}

/**
 * The faults in a pair of lists: a control named twice in one, in both, or empty. `moneyPartOf` is the question; this is the
 * audit of the answer, so a test can hand it a planted control and watch it go red.
 */
export function moneyPartProblems(offer: readonly string[], settle: readonly string[]): string[] {
  const problems: string[] = [];
  for (const [part, list] of [["offer", offer], ["settle", settle]] as const) {
    const seen = new Set<string>();
    for (const c of list) {
      if (c.trim() === "") problems.push(`an empty control in ${part}`);
      if (seen.has(c)) problems.push(`${c} is listed twice in ${part}`);
      seen.add(c);
    }
  }
  for (const c of offer) if (settle.includes(c)) problems.push(`${c} is in both parts`);
  return problems;
}

/** The home of a pot or contest of the WHOLE FIELD (an empty group key), the one place it is drawn. */
export type FieldGamesHome = "prizes" | "group-games";

/**
 * Where the field's own pots and contests are offered. A tournament offers them on Prizes & side games; a casual round has
 * no Prizes screen (it is one group, its money is `/group-games`), so its copy stays there (step 3 §4.4). The answer
 * depends only on the kind of event, never on which redesigned screens are shown: moving the offer into the new Prizes
 * screen changes how it is laid out, not which page holds it. Both pages ask this, so a field's game is mounted ONCE.
 */
export function fieldGamesHome(event: { casual: boolean }): FieldGamesHome {
  return event.casual ? "group-games" : "prizes";
}
