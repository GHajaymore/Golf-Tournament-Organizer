import { describe, it, expect } from "vitest";
import {
  resolveMoneyMode,
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

  it("hides the money screen only under none", () => {
    expect(moneyScreenApplies("none")).toBe(false);
    expect(moneyScreenApplies("float")).toBe(true);
    expect(moneyScreenApplies("split")).toBe(true);
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
