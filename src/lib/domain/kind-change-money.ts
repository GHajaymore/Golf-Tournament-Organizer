import { MONEY_MODE_LABEL, resolveMoneyMode, type MoneyMode } from "./money-mode";

/**
 * WHAT CHANGING THE KIND OF OUTFIT DOES TO MONEY — asked before it is done.
 *
 * The money mode is resolved at READ time (`resolveMoneyMode`): the
 * tournament's own choice, then the club's default, then the kind of outfit.
 * So a tournament that never chose, in a club that never chose, follows the
 * KIND — and changing the kind silently changes it. Found 2026-11-01 by
 * reading the code: a society switched to "Golf club" took every such
 * tournament from "Split shared costs" to "Costs handled outside the app", and
 * the players' shared costs, the organizer's ledger and the report's
 * shared-cost lines all went with it. Nothing was deleted; nothing said so
 * either.
 *
 * This answers the question the picker has to ask first: if the kind became
 * `toKind`, which tournaments would change, from what to what. It is built on
 * `resolveMoneyMode` and asks it twice per tournament — it does not hold a copy
 * of the fallback, so the day the rule grows a fourth level this grows with it.
 *
 * Every input is REQUIRED, including the club's own mode and the current kind:
 * leaving either out would answer a different question than the one the
 * database holds.
 */
export interface KindChangeTournament {
  id: string;
  name: string;
  /** The tournament's own money mode, "" when it follows the club. */
  moneyMode: string;
}

export interface MoneyModeFlip {
  id: string;
  name: string;
  from: MoneyMode;
  to: MoneyMode;
}

export function moneyModeFlipsOnKindChange(input: {
  /** The club's own default, "" when it follows the kind. */
  orgMode: string;
  fromKind: string;
  toKind: string;
  /** Every tournament the club holds, in the order they should be named. */
  tournaments: KindChangeTournament[];
}): MoneyModeFlip[] {
  const flips: MoneyModeFlip[] = [];
  for (const t of input.tournaments) {
    const from = resolveMoneyMode({ eventMode: t.moneyMode, orgMode: input.orgMode, orgKind: input.fromKind });
    const to = resolveMoneyMode({ eventMode: t.moneyMode, orgMode: input.orgMode, orgKind: input.toKind });
    if (from !== to) flips.push({ id: t.id, name: t.name, from, to });
  }
  return flips;
}

/**
 * What the club's own default must be set to so that NOTHING changes: the mode
 * the club resolves to today. Asked of `resolveMoneyMode` with no tournament
 * choice, which is exactly what every tournament in the flip list follows.
 */
export function moneyModeToKeep(input: { orgMode: string; fromKind: string }): MoneyMode {
  return resolveMoneyMode({ eventMode: "", orgMode: input.orgMode, orgKind: input.fromKind });
}

/** How many tournaments the question names before "and N more". */
export const KIND_CHANGE_NAMES_SHOWN = 3;

/** What the change does to the screens, in the app's words, by where it lands. */
const WHAT_CHANGES: Record<MoneyMode, string> = {
  none:
    "Shared costs and the settle-up stop showing — on the players' Money tab, on your money screen and in the report. Skins and side games are still worked out.",
  float: "They keep a tournament kitty instead: fees in, costs out, and what is left.",
  split: "Players see shared costs and who owes whom on their Money tab, and the report lists them.",
};

/**
 * The question, in words. Names the tournaments (a few, then "and N more")
 * and says what changes, because the names are what tell an organizer whether
 * this matters: "3 tournaments" is a number, "the away trip" is a decision.
 */
export function kindChangeMoneyQuestion(flips: MoneyModeFlip[]): string {
  if (flips.length === 0) return "";
  const shown = flips.slice(0, KIND_CHANGE_NAMES_SHOWN).map((f) => f.name);
  const more = flips.length - shown.length;
  const names =
    more > 0
      ? `${shown.join(", ")} and ${more} more`
      : shown.length === 1
        ? shown[0]
        : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  // Every tournament on the list follows the same default, so one from and one
  // to describe them all; the first is read rather than assumed.
  const { from, to } = flips[0];
  const count = flips.length === 1 ? "1 tournament follows" : `${flips.length} tournaments follow`;
  return (
    `${count} the default for money and would change: ${names}. ` +
    `They go from “${MONEY_MODE_LABEL[from]}” to “${MONEY_MODE_LABEL[to]}”. ${WHAT_CHANGES[to]} ` +
    `Nothing is deleted, and switching back brings it back.`
  );
}

/** The two answers the question accepts; anything else is no answer. */
export type KindChangeMoneyChoice = "keep" | "switch";

export function isKindChangeMoneyChoice(v: unknown): v is KindChangeMoneyChoice {
  return v === "keep" || v === "switch";
}
