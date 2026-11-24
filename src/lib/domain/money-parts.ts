/**
 * THE TWO HALVES OF A TOURNAMENT'S MONEY, AND WHERE A FIELD'S GAMES ARE OFFERED (R8a).
 *
 * Money is split by WHEN (step 3 §4): what is OFFERED is set up before play on Prizes & side games, and what is
 * SETTLED (who has paid, who won, the kitty, the costs, settling up) is done once the result is final on Winners & money
 * (R8b). A control is in exactly ONE part; a control in both is a second copy, and a control in neither is one nobody
 * can reach. Every action that asks the `money` scope is in the offer (shut at completion) and the settle side never
 * asks it (`docs/claude/lock-scopes.md`); three controls ask no lock at all: a contest's sponsor is drawn with its contest, who may add a cost with the money mode, and a bet's
 * name with the ledger.
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
  // Who may write a shared cost down is asked beside the money mode, in the same fold, and decided before play: drawn with the mode.
  // It asks no lock (a cost is added after the day, so the action stays open), like a contest's sponsor.
  "setExpenseEntry",
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

/**
 * WHICH SCREEN DRAWS A CONTROL, once Winners & money is shown (R8b). The part says WHEN a control is for; this says WHERE it is
 * drawn, and the two are not the same for a control that is settled on the card of the game it settles:
 *
 *   - "money"   Winners & money: who won each prize, the kitty, and settling up (`SETTLE_ON_WINNERS_AND_MONEY`).
 *   - "player"  the player's own money screen (`/me/money`), not a screen of the console and never moved: a player asks to join
 *               a pot or contest and writes a shared cost down there (`SETTLE_ON_THE_PLAYERS_SCREEN`).
 *   - "prizes"  everything else: the offer, and the settle controls that are drawn WITH the pot or contest they settle (who is in
 *               it, who has paid their stake, who won a closest-to-the-pin, a game's name). A pot's card is one card, mounted once;
 *               pulling its entrants off it to a second screen would be a second copy of the card (the Golf Pro, R8a: "do not move
 *               entrants off the pot card").
 *
 * A group's own games (`/group-games`, a section of Winners & money for a tournament's staff, `groupGamesMovedTo`) draw the same pot
 * and contest cards for the group, so their controls, OFFER controls among them (a group's pot is set up there), are the same actions
 * on the same cards in the other mount of `GroupGames`. "prizes" below means the FIELD's cards; the groups' section is the one place
 * on Winners & money that draws an offer control.
 */
export type MoneyScreen = "prizes" | "money" | "player";

export const SETTLE_ON_WINNERS_AND_MONEY = ["setPrizeWinner", "addFundLine", "removeFundLine", "recordSettlement", "removeSettlement"] as const;

export const SETTLE_ON_THE_PLAYERS_SCREEN = [
  "requestContestEntry",
  "requestSkinsEntry",
  "requestSideGameEntry",
  "addExpense",
  "updateExpense",
  "removeExpense",
] as const;

/** The screen a control is drawn on. Throws for a control with no part, like `moneyPartOf`. */
export function moneyScreenOf(control: string): MoneyScreen {
  const part = moneyPartOf(control);
  const broken = moneyScreenProblems(SETTLE_ON_WINNERS_AND_MONEY, SETTLE_ON_THE_PLAYERS_SCREEN);
  if (broken.length > 0) throw new Error(`the money screens are inconsistent: ${broken.join("; ")}`);
  if ((SETTLE_ON_WINNERS_AND_MONEY as readonly string[]).includes(control)) {
    if (part !== "settle") throw new Error(`${control} is drawn on Winners & money and is not a settle control`);
    return "money";
  }
  if ((SETTLE_ON_THE_PLAYERS_SCREEN as readonly string[]).includes(control)) {
    if (part !== "settle") throw new Error(`${control} is drawn on the player's screen and is not a settle control`);
    return "player";
  }
  return "prizes";
}

/** The half of the prize table (`PrizesClient`'s `part`) a screen draws. Both pages ask this, so the table is never drawn twice. */
export type PrizeTableHalf = "both" | "offer" | "settle";

/**
 * Which half of the prize table is drawn on `screen`: Winners & money draws the winners (the settle half) and Prizes & side games
 * the lines (the offer half) while Winners & money is shown; with it not shown Prizes draws the one whole table it always has.
 * `moneyShown` is the page's own `shown.has("money")`, so this is the ONE answer to "is a prize's winner picker on this screen".
 */
export function prizeTableHalf(screen: "prizes" | "money", moneyShown: boolean): PrizeTableHalf {
  if (screen === "money") return "settle";
  return moneyShown ? "offer" : "both";
}

/**
 * The faults in the two settle-screen lists: a control in both, or one that is empty. Like `moneyPartProblems`, so a test can hand
 * it a planted control and watch it go red.
 */
export function moneyScreenProblems(winnersAndMoney: readonly string[], playerScreen: readonly string[]): string[] {
  const problems: string[] = [];
  for (const [screen, list] of [["Winners & money", winnersAndMoney], ["the player's screen", playerScreen]] as const) {
    for (const c of list) if (c.trim() === "") problems.push(`an empty control for ${screen}`);
    if (new Set(list).size !== list.length) problems.push(`a control is listed twice for ${screen}`);
  }
  for (const c of winnersAndMoney) if (playerScreen.includes(c)) problems.push(`${c} is drawn on Winners & money and on the player's screen`);
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
