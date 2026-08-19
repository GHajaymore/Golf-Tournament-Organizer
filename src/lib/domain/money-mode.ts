import { orgProfile } from "./org-profile";

/**
 * What this tournament does with money, if anything.
 *
 * There were two behaviours and no way to choose between them: the ledger
 * appeared once somebody entered a line, and there was no way to say "we do
 * not do that here". That guess is wrong in both directions — a society that
 * settles at the bar sees a settle-up nobody asked for, and one that has not
 * entered anything yet cannot tell whether the feature exists.
 *
 * Three modes, because "does this tournament handle money" turned out to be
 * two different questions that were being answered as one:
 *
 *   NONE  — the club shop takes the entry fee and pays the winner, so the app
 *           keeps no kitty and no settle-up. It still settles the POTS: skins,
 *           2s, closest-to-the-pin. Those are a result, not a cash book, and
 *           they are the same at a club as anywhere else.
 *   FLOAT — a kitty. Fees come IN, prizes and the celebration go OUT, and the
 *           question is whether the tournament balanced and what is left. One
 *           pot belonging to the tournament, not a web of debts.
 *   SPLIT — who owes whom. A minibus somebody fronted, green fees one person
 *           put on a card, dinner divided nine ways. This is the existing
 *           ledger.
 *
 * Float and split are genuinely different questions and conflating them is how
 * a settle-up ends up telling a player they owe the organizer thirty pounds
 * they already paid at signup. Float money has left the players' hands; split
 * money has not.
 */
export type MoneyMode = "none" | "float" | "split";

export const MONEY_MODES: MoneyMode[] = ["none", "float", "split"];

export function isMoneyMode(v: string): v is MoneyMode {
  return (MONEY_MODES as string[]).includes(v);
}

export const MONEY_MODE_LABEL: Record<MoneyMode, string> = {
  // Not "No money in the app": the skins and the 2s pot are still worked out
  // and still shown, at a club as much as anywhere. What this mode turns off
  // is the app handling the FEES and the shared costs.
  none: "Costs handled outside the app",
  float: "Tournament kitty",
  split: "Split shared costs",
};

export const MONEY_MODE_HELP: Record<MoneyMode, string> = {
  none: "Entry fees and prizes are handled outside the app — the shop, the bar, an envelope. Skins, 2s and side bets are still worked out and shown to the players.",
  float:
    "Track the entry fees in and the costs out — trophies, prizes, the meal — and see whether the tournament balanced and what is left over. One pot belonging to the tournament; nobody owes anybody.",
  split:
    "For costs somebody fronted and everybody owes a share of: the minibus, the green fees, dinner. Works out who pays whom in the fewest transfers, with the side-game winnings folded in.",
};

/**
 * The mode in force, from the tournament, the club, and the kind of outfit.
 *
 * Three levels, narrowest first, because the question is genuinely per
 * tournament: a society runs a thirty-pound Sunday roll-up and a three-day
 * away trip with a minibus in the same season, and one setting cannot be right
 * for both. The club's own setting is the default it usually works to, and the
 * kind is the fallback for a club that has never been asked.
 *
 * The kind fallback preserves what every existing organization does today —
 * a club sees no ledger, everyone else sees the split one — so turning this on
 * changes nothing until somebody chooses.
 */
export function resolveMoneyMode(input: {
  /** The tournament's own choice. Empty means "follow the club". */
  eventMode?: string | null;
  /** The club's default. Empty means "follow the kind of outfit we are". */
  orgMode?: string | null;
  orgKind?: string | null;
}): MoneyMode {
  const event = (input.eventMode ?? "").trim();
  if (isMoneyMode(event)) return event;

  const org = (input.orgMode ?? "").trim();
  if (isMoneyMode(org)) return org;

  // A club or a course leaves the cash to the shop; everyone else gets the
  // ledger they have today.
  return orgProfile(input.orgKind).ledger ? "split" : "none";
}

/**
 * Whether this tournament handles shared costs or a kitty inside the app.
 *
 * This was called `moneyScreenApplies`, and the name was the bug: it reads as
 * "show the money screen", so `none` hid the screen entirely — including the
 * skins, which every club runs and which the app is the only thing working
 * out. The mode governs the LEDGER and the KITTY. Whether there is a money
 * screen is a wider question, asked by `usesExpenses`, because a pot exists
 * whatever the club does about entry fees.
 */
export function sharedCostsApply(mode: MoneyMode): boolean {
  return mode !== "none";
}

/**
 * Whether the money screen exists at all — the rule, in one place.
 *
 * TWO independent reasons for it to exist, and collapsing them to one is what
 * went wrong:
 *
 *   - the tournament handles costs in the app (a kitty, or a settle-up), OR
 *   - somebody staked in a pot, whatever the club does about entry fees.
 *
 * A club is `none` by default and correctly so — the shop takes the fee and
 * pays the winner — but it runs skins and a 2s pot every Saturday, and the app
 * is the only thing that works out who won them. With one reason instead of
 * two, the organizer settled the skins on the prizes screen (gated on the
 * round, not the mode, so it always worked) and every player was redirected
 * away from the result. The calculation ran and nobody it belonged to could
 * see it.
 */
export function moneyScreenApplies(input: { mode: MoneyMode; hasPots: boolean }): boolean {
  return sharedCostsApply(input.mode) || input.hasPots;
}

/**
 * A line in the tournament's kitty.
 *
 * `direction` rather than a signed amount, because a negative number in a
 * money column is read wrong by somebody eventually — and the split ledger
 * next door divides amounts between players, where a negative would silently
 * invert a debt.
 */
export interface FundLine {
  direction: "in" | "out";
  amountCents: number;
}

export interface FloatSummary {
  /** Fees and anything else collected. */
  inCents: number;
  /** Prizes, trophies, the meal. */
  outCents: number;
  /** What is left. Negative means the tournament is out of pocket. */
  balanceCents: number;
  /** True when more went out than came in — worth saying plainly. */
  shortfall: boolean;
}

export function floatSummary(lines: FundLine[]): FloatSummary {
  let inCents = 0;
  let outCents = 0;
  for (const l of lines) {
    // A line with a nonsense amount contributes nothing rather than poisoning
    // the total: a kitty that reads NaN is worse than one missing a line.
    if (!Number.isFinite(l.amountCents)) continue;
    const cents = Math.round(l.amountCents);
    if (l.direction === "in") inCents += cents;
    else outCents += cents;
  }
  const balanceCents = inCents - outCents;
  return { inCents, outCents, balanceCents, shortfall: balanceCents < 0 };
}
