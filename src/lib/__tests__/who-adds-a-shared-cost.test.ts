import { describe, it, expect } from "vitest";
import {
  canAddExpense,
  resolveExpenseEntry,
  isExpenseEntry,
  EXPENSE_ENTRY_MODES,
  EXPENSE_ENTRY_LABEL,
} from "../domain/expense-entry";
import { CONTEST_KINDS, CONTEST_LABEL, contestHasHole, contestNets } from "../domain/contests";
import { readSource } from "./source";

/**
 * WHO MAY WRITE A SHARED COST DOWN, AND WHERE POKER GOES.
 *
 * Two questions about an outing's money, and the second is the one that is
 * easy to get wrong. The line is not golf-versus-not:
 *
 *   a POT is money players staked against each other; the app's arithmetic
 *   decides who gets it. Poker is one. So is the long drive.
 *
 *   a SHARED COST is money one person fronted for the group; the app decides
 *   who owes them. Green fees are one. So is the minibus.
 *
 * Green fees are golf and are a cost; poker is not golf and is a pot. Sorting
 * by "is it golf" puts both in the wrong book.
 */

describe("who may add a shared cost", () => {
  it("lets anyone playing add one unless the tournament says otherwise", () => {
    /**
     * THE DEFAULT IS WHAT ALREADY HAPPENS, and that is the whole argument for
     * it. `addExpense` has always taken a plain event session, so every
     * tournament in split mode today lets its players add lines. A default of
     * "staff" would silently remove that on the day this ships.
     */
    expect(resolveExpenseEntry({ eventEntry: "" })).toBe("anyone");
    expect(resolveExpenseEntry({ eventEntry: null })).toBe("anyone");
    expect(resolveExpenseEntry({ eventEntry: undefined })).toBe("anyone");
    expect(canAddExpense({ entry: resolveExpenseEntry({ eventEntry: "" }), isStaff: false })).toBe(true);
  });

  it("stops a player once the organizers keep the book", () => {
    expect(canAddExpense({ entry: "staff", isStaff: false })).toBe(false);
    // And the control: the same person, same setting, nothing else changed.
    expect(canAddExpense({ entry: "anyone", isStaff: false })).toBe(true);
  });

  it("never locks out the organizer who set it", () => {
    // A setting that shut the person who chose it out of their own ledger
    // would be a trap rather than a policy. The switch only restricts players.
    expect(canAddExpense({ entry: "staff", isStaff: true })).toBe(true);
    expect(canAddExpense({ entry: "anyone", isStaff: true })).toBe(true);
  });

  it("treats an unrecognised stored value as the default, not as a third state", () => {
    /**
     * The column is free text and a `"use server"` export is a public HTTP
     * endpoint — the action validates, and a row written before this existed,
     * or by a future version, still has to resolve to something. It resolves
     * the permissive way, which matches every row in the database today.
     */
    expect(resolveExpenseEntry({ eventEntry: "organisers" })).toBe("anyone");
    expect(resolveExpenseEntry({ eventEntry: "STAFF" })).toBe("anyone");
    expect(resolveExpenseEntry({ eventEntry: "  staff  " })).toBe("staff");
    expect(isExpenseEntry("staff")).toBe(true);
    expect(isExpenseEntry("everyone")).toBe(false);
  });

  it("offers exactly two answers, each with words of its own", () => {
    // Two, not three: there is no "the payer only" because that is what
    // `canChangeExpense` already governs for EDITING, and a third answer to a
    // question with two would be the picker growing a matrix.
    expect(EXPENSE_ENTRY_MODES).toEqual(["anyone", "staff"]);
    for (const m of EXPENSE_ENTRY_MODES) {
      expect(EXPENSE_ENTRY_LABEL[m].trim().length, m).toBeGreaterThan(0);
    }
    expect(EXPENSE_ENTRY_LABEL.anyone).not.toBe(EXPENSE_ENTRY_LABEL.staff);
  });
});

describe("the refusal is on the action, not only on the form", () => {
  /**
   * The rule this file's header states about every export in that file: a
   * `"use server"` export is a public HTTP endpoint and will be called with
   * whatever the caller likes. Hiding the button is a courtesy; the action is
   * the gate.
   *
   * Read through `readSource`, which strips comments — the prose above the
   * check names the helper and would otherwise satisfy the assertion on its
   * own. See source-guard.test.ts for the afternoon that taught this.
   */
  const action = () => readSource("src", "app", "actions", "expenses.ts");

  it("checks it inside addExpense", () => {
    const src = action();
    const start = src.indexOf("export async function addExpense");
    expect(start, "addExpense is gone").toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("export async function updateExpense"));
    expect(body, "addExpense does not ask who may add").toContain("canAddExpense(");
  });

  it("asks before it writes, not after", () => {
    // A check after `prisma.expense.create` is not a check. Position is the
    // assertion because the call being present says nothing about that.
    const src = action();
    const start = src.indexOf("export async function addExpense");
    const body = src.slice(start, src.indexOf("export async function updateExpense"));
    expect(body.indexOf("canAddExpense(")).toBeLessThan(body.indexOf("prisma.expense.create"));
  });

  it("refuses with a sentence that says who can", () => {
    /**
     * The idiom this codebase uses for a closed door — `resolveThirdPlace` and
     * the draw button both explain rather than disappear. The person reading
     * it is holding a receipt for the minibus; "not allowed" leaves them with
     * nowhere to take it.
     */
    const src = action();
    const start = src.indexOf("export async function addExpense");
    const body = src.slice(start, src.indexOf("export async function updateExpense"));
    const refusal = body.slice(body.indexOf("canAddExpense("), body.indexOf("cleanInput"));
    expect(refusal).toMatch(/organizers/i);
  });
});

describe("an off-course game is a pot, not a cost", () => {
  it("is offered as its own kind rather than filed under 'side bet'", () => {
    /**
     * It fitted under `other` before, and that is exactly why it needed a name:
     * a trip's poker school filed as "Side bet" reads as a bet on the round,
     * and the alternative an organizer reaches for is the EXPENSE ledger —
     * which would turn money won off another player into money owed to one.
     */
    expect(CONTEST_KINDS).toContain("off-course");
    expect(CONTEST_LABEL["off-course"]).toMatch(/poker/i);
  });

  it("needs no arithmetic of its own — it is the same pot", () => {
    /**
     * THE REASON THIS IS FOUR LINES AND NOT A FEATURE. `contestNets` knows
     * nothing about golf: everybody puts in, the winners share, split exactly.
     * A £10 poker night among four with one winner is £30 to them and £10 off
     * each of the others, by the code that already settles the long drive.
     */
    const nets = contestNets({
      id: "p1",
      kind: "off-course",
      name: "Saturday poker",
      buyInCents: 1000,
      entrantIds: ["a", "b", "c", "d"],
      winnerIds: ["a"],
    });
    const by = new Map(nets.map((n) => [n.playerId, n.netCents]));
    expect(by.get("a")).toBe(3000);
    expect(by.get("b")).toBe(-1000);
    expect(by.get("c")).toBe(-1000);
    expect(by.get("d")).toBe(-1000);
    // Zero-sum, which is what makes it a pot rather than a cost: nothing
    // entered the outing and nothing left it.
    expect([...by.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("splits a shared win to the cent, like every other pot", () => {
    // Three winners of a £25 pot is 834/833/833, never £8.33 three times with
    // a penny left in the app's pocket.
    const nets = contestNets({
      id: "p2",
      kind: "off-course",
      name: "The quiz",
      buyInCents: 500,
      entrantIds: ["a", "b", "c", "d", "e"],
      winnerIds: ["a", "b", "c"],
    });
    expect(nets.reduce((s, n) => s + n.netCents, 0)).toBe(0);
  });

  it("does not ask for a hole", () => {
    // Poker is not played on the 7th. Declared on the kind so a kind added
    // later has one place to say so, rather than a condition in a form.
    expect(contestHasHole("off-course")).toBe(false);
    expect(contestHasHole("closest-pin")).toBe(true);
    expect(contestHasHole("long-drive")).toBe(true);
    expect(contestHasHole("other")).toBe(true);
  });

  it("is asked through contestHasHole by the form, not by a test on the kind", () => {
    /**
     * The half a domain test cannot see. Without this the form could go on
     * demanding a hole number for the poker school while every assertion above
     * passed — and the stale "7" from a previous long-drive entry would file
     * the poker night on the 7th.
     */
    const src = readSource("src", "components", "ContestsClient.tsx");
    expect(src).toContain("contestHasHole(kind)");
    // Twice at least: once to hide the field, once so a stale value is not sent.
    expect(src.split("contestHasHole(kind)").length - 1).toBeGreaterThan(1);
  });
});

describe("what the player screen says instead of the button", () => {
  /**
   * A button that has silently vanished reads as a bug, and the person reading
   * it is holding a receipt for the minibus. Naming who to hand it to is the
   * difference between a closed door and a locked one — the same idiom as the
   * draw button, which explains and links rather than greying out.
   *
   * Read from source rather than rendered: `MoneyClient` is a client component
   * with a dozen hooks and a `useAction`, and standing all of that up to check
   * one sentence would be a test about React. What has to hold is that the
   * branch exists, reads the view's own answer, and says something.
   */
  const client = () => readSource("src", "components", "MoneyClient.tsx");

  it("branches on the view's answer rather than deciding again", () => {
    // Two copies of one rule is how they come to disagree — and the copy on
    // the screen is the one a player would believe.
    expect(client()).toContain("view.canAddExpense");
    expect(client(), "the screen worked the rule out for itself").not.toContain("resolveExpenseEntry");
  });

  it("says who to give the receipt to", () => {
    const src = client();
    const branch = src.slice(src.indexOf("!view.canAddExpense"));
    expect(branch.slice(0, 900)).toMatch(/organizers/i);
  });
});
