import { describe, it, expect } from "vitest";
import {
  EXPENSE_CATEGORIES,
  isExpenseCategory,
  expenseCategoryLabel,
  totalsByCategory,
} from "@/lib/domain/expense-categories";

describe("filing what a golf trip costs", () => {
  it("covers what a trip actually generates", () => {
    const keys = EXPENSE_CATEGORIES.map((c) => c.key);
    // The ones a weekend away produces. A ledger that cannot file the lodging
    // is a green-fee splitter, and the lodging is the larger number.
    for (const needed of ["lodging", "travel", "fuel", "green-fee", "cart", "food"]) {
      expect(keys, `${needed} is not offered`).toContain(needed);
    }
    // And an escape hatch, or one line gets filed wrongly rather than honestly.
    expect(keys).toContain("other");
    expect(keys[keys.length - 1]).toBe("other");
  });

  it("has no duplicate keys and a label for every one", () => {
    const keys = EXPENSE_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of EXPENSE_CATEGORIES) expect(c.label.trim().length).toBeGreaterThan(2);
  });

  it("recognises its own values and refuses others", () => {
    expect(isExpenseCategory("lodging")).toBe(true);
    expect(isExpenseCategory("office-supplies")).toBe(false);
    expect(isExpenseCategory("")).toBe(false);
  });

  it("keeps showing a value it no longer offers", () => {
    // A row filed before this list existed is a RECORD. Blanking it would be
    // the ledger quietly dropping a word somebody wrote.
    expect(expenseCategoryLabel("lodging")).toBe("Lodging");
    expect(expenseCategoryLabel("helicopter")).toBe("helicopter");
  });

  it("adds a trip up by category, largest first", () => {
    const rows = [
      { category: "lodging", amountCents: 64000 },
      { category: "travel", amountCents: 12000 },
      { category: "fuel", amountCents: 6000 },
      { category: "food", amountCents: 21460 },
      { category: "lodging", amountCents: 8000 },
      // Unfiled lines are "other" rather than lost — the total has to match
      // the sum of the lines or the ledger is not a ledger.
      { category: "", amountCents: 500 },
    ];
    const totals = totalsByCategory(rows);
    expect(totals[0]).toEqual({ category: "lodging", label: "Lodging", cents: 72000 });
    expect(totals.find((t) => t.category === "other")?.cents).toBe(500);
    const summed = totals.reduce((s, t) => s + t.cents, 0);
    expect(summed).toBe(rows.reduce((s, r) => s + r.amountCents, 0));
  });
});
