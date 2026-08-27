import { balances, combinedBalances, shareOf, paymentsOf, type Expense, type Net } from "@/lib/domain/expenses";
import { splitExactly, settle } from "@/lib/domain/money";

/**
 * Which generation of the money rules produced a number.
 *
 * TourneyHQ records money. A player is told they owe £23.50, hands it over,
 * and the payment is written down — but the £23.50 itself is worked out LIVE,
 * every time the screen is opened, from the expenses, the skins and the side
 * games as they stand at that moment. So when a rule is later corrected, and
 * they are (the combination sweep in matrix.test.ts exists because they were),
 * the same ledger quietly starts answering a different number. The payment on
 * file then looks like an underpayment against a total nobody remembers being
 * told, and there is nothing anywhere that says which set of rules produced
 * the figure the money was actually handed over against.
 *
 * WHY THIS IS NOT A CONSTANT SOMEBODY BUMPS. The obvious shape is
 * `const RULES_VERSION = 3`, incremented by hand when the rules change. That
 * is precisely the thing this codebase has learned not to build: a guard you
 * must remember to invoke is a guard that will be forgotten, and the one time
 * it is forgotten is the one time it mattered — a rule changed, the version
 * did not, and two generations of results now claim to be the same one.
 *
 * So the version IS THE ANSWER THE RULES GIVE. A fixed, deliberately awkward
 * ledger is run through the real functions and the outcome is hashed. Change
 * how a share is apportioned, how a remainder is allocated, how debts are
 * netted or who pays whom, and the hash moves on its own. Leave the behaviour
 * alone — rename things, add comments, refactor the internals — and it does
 * not. That is the correct sensitivity: it tracks what the rules DO, which is
 * the only thing a recorded payment cares about.
 *
 * `moneyRulesVersion` is checked against a recorded value in its test, so a
 * behaviour change cannot land silently: the suite fails and somebody has to
 * write down what moved and why.
 */

/** FNV-1a, the same digest `cardRevision` uses. Short, stable, not a secret. */
function digest(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36);
}

/**
 * A ledger chosen to be awkward in every way the rules can be wrong.
 *
 * Not a tidy four-ball with round numbers — that agrees with almost any
 * implementation. Every row here exists to pin down one decision:
 *
 *  - `buggies` is 4001p over three people, so it cannot divide evenly and the
 *    remainder has to land SOMEWHERE. Which player gets the odd penny is a
 *    rule, and a silent change to it is exactly this file's reason to exist.
 *  - `caddie` carries weights 3:1, so a change from even-split to weighted
 *    (or a change in how weight zero is treated) shows up.
 *  - `dinner` is paid by two people via `payments`, not one `paidBy`, which is
 *    a different code path and a common source of sign errors.
 *  - `refund` is negative, pinning the decision that a refund is the magnitude
 *    split and then negated.
 *  - `lodging` names a player in `shares` who paid nothing, so the debt has a
 *    direction to get backwards.
 */
const LEDGER: Expense[] = [
  {
    id: "e1",
    description: "buggies",
    amountCents: 4001,
    paidBy: "ana",
    shares: [
      { playerId: "ana", weight: 1 },
      { playerId: "bo", weight: 1 },
      { playerId: "cy", weight: 1 },
    ],
  },
  {
    id: "e2",
    description: "caddie",
    amountCents: 9000,
    paidBy: "bo",
    shares: [
      { playerId: "ana", weight: 3 },
      { playerId: "bo", weight: 1 },
    ],
  },
  {
    id: "e3",
    description: "dinner",
    amountCents: 12345,
    paidBy: "cy",
    payments: [
      { playerId: "cy", amountCents: 8000 },
      { playerId: "dee", amountCents: 4345 },
    ],
    shares: [
      { playerId: "ana", weight: 1 },
      { playerId: "bo", weight: 1 },
      { playerId: "cy", weight: 1 },
      { playerId: "dee", weight: 1 },
    ],
  },
  {
    id: "e4",
    description: "refund",
    amountCents: -2500,
    paidBy: "ana",
    shares: [
      { playerId: "ana", weight: 1 },
      { playerId: "dee", weight: 1 },
    ],
  },
  {
    id: "e5",
    description: "lodging",
    amountCents: 30000,
    paidBy: "dee",
    shares: [
      { playerId: "ana", weight: 2 },
      { playerId: "bo", weight: 2 },
      { playerId: "cy", weight: 1 },
      { playerId: "dee", weight: 0 },
    ],
  },
];

/** Winnings and losses from the games, which net against the ledger. */
const GAME_NETS: Net[] = [
  { playerId: "ana", netCents: -1500 },
  { playerId: "bo", netCents: 2500 },
  { playerId: "cy", netCents: -3000 },
  { playerId: "dee", netCents: 2000 },
];

const FIELD = ["ana", "bo", "cy", "dee"];

/**
 * Every money rule, exercised, flattened to a string.
 *
 * The per-expense maps are included as well as the final transfers: two
 * different apportionments can coincidentally net to the same transfers on one
 * fixture, and a version that missed that would be claiming a rule had not
 * changed when it had.
 */
function fingerprint(): string {
  const parts: string[] = [];

  for (const e of LEDGER) {
    parts.push(`share:${e.id}:${[...shareOf(e)].sort().map(([p, c]) => `${p}=${c}`).join(",")}`);
    parts.push(`paid:${e.id}:${[...paymentsOf(e)].sort().map(([p, c]) => `${p}=${c}`).join(",")}`);
  }

  const expenseNets = balances(LEDGER, FIELD);
  parts.push(`net:${expenseNets.map((n) => `${n.playerId}=${n.netCents}`).join(",")}`);

  const combined = combinedBalances(expenseNets, GAME_NETS);
  parts.push(`combined:${combined.map((n) => `${n.playerId}=${n.netCents}`).join(",")}`);

  parts.push(
    `transfers:${settle(combined).map((t) => `${t.fromPlayerId}>${t.toPlayerId}=${t.cents}`).join(",")}`,
  );

  // Remainder allocation, pinned directly rather than only through the ledger:
  // it is the rule most likely to change by one penny and least likely to show
  // up in a net that rounds back to the same place.
  parts.push(`split:${splitExactly(1000, [1, 1, 1]).join(",")}`);
  parts.push(`split:${splitExactly(4001, [3, 2, 1]).join(",")}`);
  parts.push(`split:${splitExactly(7, [1, 1, 1, 1, 1]).join(",")}`);

  return parts.join("|");
}

/**
 * The current generation of the money rules, as a short stable token.
 *
 * Stamped onto anything that records a computed money figure, so a row can
 * always answer "which rules said this?".
 */
export function moneyRulesVersion(): string {
  return `m${digest(fingerprint())}`;
}

/** The fingerprint itself, for a test that needs to say WHAT moved. */
export function moneyRulesFingerprint(): string {
  return fingerprint();
}
