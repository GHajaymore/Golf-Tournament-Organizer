/**
 * WHO MAY ADD A SHARED COST, which is not the same question as who may see one.
 *
 * `split` mode has always let ANYBODY in the field add a line — `addExpense`
 * takes a plain event session and nothing more — and for the case it was
 * written for that is exactly right. Nine people on an away trip, one fronts
 * the minibus, another the dinner, a third the second round's green fees:
 * making all of that go through the organizer turns a shared ledger into a
 * secretary's inbox, and the lines stop being entered.
 *
 * It is wrong for the other shape of the same mode. A club running a society
 * day with a treasurer wants one book with one hand in it, and a member adding
 * "dinner £312, split 24 ways" from the bar is not a contribution — it is a
 * line the treasurer now has to argue about. There was no way to say so.
 *
 * TWO ANSWERS, NOT A FOURTH MONEY MODE. `MoneySetup` says of the three modes
 * that choosing wrong between them is not cheap, and "split, but only I may
 * add" is not a fourth answer to "what does this tournament do with money" —
 * it is a qualifier on one of the three. A fourth mode turns a picker into a
 * matrix; this renders under the `split` radio and only when it is chosen.
 *
 * IT IS NOT A GOLF/NOT-GOLF SPLIT, and that is worth writing down because it
 * is the obvious way to describe it and it is wrong. Green fees, cart fees and
 * a caddie are golf and belong in exactly this ledger —
 * `EXPENSE_CATEGORIES` lists all three. The line that actually matters is
 * WHOSE MONEY IT IS:
 *
 *   a POT is money players staked against each other, and the app's arithmetic
 *   decides who gets it. Never gated by anything here — see
 *   `moneyScreenApplies`, which keeps skins alive even in `none` mode.
 *
 *   a SHARED COST is money one person fronted for the group, and the app works
 *   out who owes whom. That is `split`, and this says who may write one down.
 *
 * Calling the switch "non-golf expenses" would put green fees in the wrong
 * place on the first day and leave the app with two homes for one receipt.
 */

export type ExpenseEntry = "anyone" | "staff";

export const EXPENSE_ENTRY_MODES: ExpenseEntry[] = ["anyone", "staff"];

export function isExpenseEntry(v: string): v is ExpenseEntry {
  return (EXPENSE_ENTRY_MODES as string[]).includes(v);
}

export const EXPENSE_ENTRY_LABEL: Record<ExpenseEntry, string> = {
  anyone: "Anyone playing can add a cost",
  staff: "Only the organizers add costs",
};

export const EXPENSE_ENTRY_HELP: Record<ExpenseEntry, string> = {
  anyone:
    "Whoever fronted the minibus, the dinner or a round of green fees writes it down themselves. They can edit their own lines; nobody can edit anybody else's.",
  staff:
    "Players see the ledger and what they owe, and the organizers are the only ones who enter a line. For a treasurer who wants one book with one hand in it.",
};

/**
 * The answer in force, from what the tournament stored.
 *
 * EMPTY MEANS `anyone`, and that is a deliberate choice about the existing
 * customer base rather than a shrug. Every tournament in `split` mode today
 * lets its players add lines, because there has never been anything else; a
 * default of `staff` would silently take a capability away from people already
 * using it on the day this ships. A club that wants the other answer chooses
 * it, which is one click on a screen the setup guide now walks them to.
 *
 * NOT inherited from the club, unlike `resolveMoneyMode`. The club default
 * exists because the MODE is a standing policy — a club runs its money one way
 * most of the time. This is a property of the trip: the same society's Sunday
 * roll-up and its three-day away day want opposite answers, and a club-level
 * default would be a setting that is wrong half the time and looks deliberate.
 */
export function resolveExpenseEntry(input: { eventEntry?: string | null }): ExpenseEntry {
  const v = (input.eventEntry ?? "").trim();
  return isExpenseEntry(v) ? v : "anyone";
}

/**
 * Whether this person may write a new shared cost down.
 *
 * Staff always may — an organizer who could not enter a line on their own
 * tournament's ledger would be a setting that locks out the person who set it.
 * So the switch only ever restricts players.
 *
 * The refusal it produces lives with the action, because a `"use server"`
 * export is a public HTTP endpoint and a hidden form stops nobody. This is
 * the rule both of them read.
 */
export function canAddExpense(input: { entry: ExpenseEntry; isStaff: boolean }): boolean {
  return input.isStaff || input.entry === "anyone";
}
