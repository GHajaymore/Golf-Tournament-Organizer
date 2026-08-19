import { describe, it, expect } from "vitest";
import {
  resolveMoneyMode,
  sharedCostsApply,
  moneyScreenApplies,
  floatSummary,
  isMoneyMode,
  MONEY_MODES,
} from "@/lib/domain/money-mode";

describe("which mode is in force", () => {
  it("changes nothing for an organization that has never been asked", () => {
    // The whole point of the empty defaults. Every club and event in the
    // database has "" for both columns, and must keep behaving as it does.
    expect(resolveMoneyMode({ orgKind: "club" })).toBe("none");
    expect(resolveMoneyMode({ orgKind: "community" })).toBe("split");
    expect(resolveMoneyMode({ orgKind: "personal" })).toBe("split");
    // `course` was a kind until 2026-08-18 and is now an unknown string, so it
    // takes the orgProfile fallback to `personal` and gets the ledger. That is
    // the safe direction — a typo in the column should never be the reason
    // somebody is not told they are owed — and no row has ever held it.
    expect(resolveMoneyMode({ orgKind: "course" })).toBe("split");
  });

  it("lets the club set its own default", () => {
    expect(resolveMoneyMode({ orgMode: "float", orgKind: "community" })).toBe("float");
    // Including a club deciding it does want to run a kitty after all.
    expect(resolveMoneyMode({ orgMode: "float", orgKind: "club" })).toBe("float");
  });

  it("lets one tournament differ from the club", () => {
    // The case the org-level setting alone gets wrong: a society runs a thirty
    // pound Sunday roll-up and a three-day trip with a minibus, in the same
    // season, and one setting cannot be right for both.
    expect(resolveMoneyMode({ eventMode: "split", orgMode: "float", orgKind: "community" })).toBe("split");
    expect(resolveMoneyMode({ eventMode: "none", orgMode: "split", orgKind: "community" })).toBe("none");
  });

  it("ignores a value it does not recognise and falls through", () => {
    // A stored mode is free text. An unknown value must not land in whichever
    // branch happens to be the else — it should behave as though unset.
    expect(resolveMoneyMode({ eventMode: "kitty", orgMode: "float", orgKind: "club" })).toBe("float");
    expect(resolveMoneyMode({ eventMode: "", orgMode: "  ", orgKind: "club" })).toBe("none");
    expect(resolveMoneyMode({ eventMode: null, orgMode: null, orgKind: null })).toBe("split");
  });

  it("validates a mode", () => {
    expect(MONEY_MODES.every(isMoneyMode)).toBe(true);
    expect(isMoneyMode("ledger")).toBe(false);
  });

  it("turns off the shared costs only under none", () => {
    // Note what this does NOT decide: whether there is a money screen. A club
    // is `none` and still runs skins, and the players have to be able to see
    // who won them — see moneyScreenApplies.
    expect(sharedCostsApply("none")).toBe(false);
    expect(sharedCostsApply("float")).toBe(true);
    expect(sharedCostsApply("split")).toBe(true);
  });
});

describe("whether the money screen exists", () => {
  it("shows the pots to a club that handles its cash outside the app", () => {
    // THE REGRESSION THIS FILE EXISTS FOR. A club resolves to `none` — right,
    // the shop takes the fee and pays the winner — and used to lose the whole
    // money tab with it. But the club runs skins and a 2s pot every Saturday,
    // the app is the only thing that works out who won them, and the players
    // were redirected away from the answer while the organizer could see it on
    // the prizes screen. A pot is a RESULT, not a cash book.
    expect(moneyScreenApplies({ mode: "none", hasPots: true })).toBe(true);
  });

  it("shows nothing to a club with no pots at all", () => {
    // The other direction matters just as much: an empty money screen implies
    // something is missing. No costs in the app and no pot means no screen.
    expect(moneyScreenApplies({ mode: "none", hasPots: false })).toBe(false);
  });

  it("exists under a kitty or a settle-up before anyone has used it", () => {
    // Offered as soon as the tournament is set up, or the first person who
    // needs to add a line cannot find where to do it.
    expect(moneyScreenApplies({ mode: "float", hasPots: false })).toBe(true);
    expect(moneyScreenApplies({ mode: "split", hasPots: false })).toBe(true);
  });

  it("never depends on the org kind directly", () => {
    // The kind has already had its say, inside resolveMoneyMode. Asking it
    // twice is how a club that deliberately set one tournament to split got
    // the tab and then no ledger on it.
    for (const mode of MONEY_MODES) {
      for (const hasPots of [true, false]) {
        expect(moneyScreenApplies({ mode, hasPots })).toBe(sharedCostsApply(mode) || hasPots);
      }
    }
  });
});

describe("the kitty", () => {
  const line = (direction: "in" | "out", amountCents: number) => ({ direction, amountCents });

  it("adds up what came in and what went out", () => {
    const s = floatSummary([
      line("in", 30_00),
      line("in", 30_00),
      line("out", 45_00),
    ]);
    expect(s.inCents).toBe(60_00);
    expect(s.outCents).toBe(45_00);
    expect(s.balanceCents).toBe(15_00);
    expect(s.shortfall).toBe(false);
  });

  it("says plainly when the tournament is out of pocket", () => {
    // Worth its own flag rather than leaving a reader to notice a minus sign.
    const s = floatSummary([line("in", 20_00), line("out", 75_00)]);
    expect(s.balanceCents).toBe(-55_00);
    expect(s.shortfall).toBe(true);
  });

  it("balances to zero when it balances", () => {
    const s = floatSummary([line("in", 100_00), line("out", 100_00)]);
    expect(s.balanceCents).toBe(0);
    expect(s.shortfall).toBe(false);
  });

  it("is empty rather than broken with no lines", () => {
    expect(floatSummary([])).toEqual({ inCents: 0, outCents: 0, balanceCents: 0, shortfall: false });
  });

  it("drops a nonsense amount rather than poisoning the total", () => {
    // A kitty reading NaN is worse than one missing a line — the first is
    // unusable, the second is visibly incomplete.
    const s = floatSummary([line("in", 30_00), line("in", Number.NaN), line("out", 10_00)]);
    expect(s.inCents).toBe(30_00);
    expect(s.balanceCents).toBe(20_00);
  });

  it("keeps whole cents", () => {
    // Money is integer cents throughout this app so no total is ever a
    // rounded float.
    const s = floatSummary([line("in", 33.4), line("out", 11.6)]);
    expect(Number.isInteger(s.inCents)).toBe(true);
    expect(Number.isInteger(s.balanceCents)).toBe(true);
  });
});
