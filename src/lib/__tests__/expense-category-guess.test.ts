import { describe, it, expect } from "vitest";
import { guessExpenseCategory, isExpenseCategory, totalsByCategory } from "../domain/expense-categories";

/**
 * THE FORM ASKED THE SAME QUESTION TWICE.
 *
 * "What was it for?" and then "Category", so a line read "Buggies · Cart fees"
 * and whoever entered it had answered the same thing in two controls — with
 * nothing on the screen ever using the second answer. Walked on 2026-09-19.
 *
 * The category is kept and made to earn its place: it fills itself in from the
 * description, stays editable, and the ledger now totals by it. These are the
 * cases that decide whether the guess is worth having.
 */

describe("guessing what an expense was", () => {
  it("reads the obvious ones", () => {
    expect(guessExpenseCategory("Buggies")).toBe("cart");
    expect(guessExpenseCategory("Hotel, two nights")).toBe("lodging");
    expect(guessExpenseCategory("Minibus to the course")).toBe("travel");
    expect(guessExpenseCategory("Green fees")).toBe("green-fee");
    expect(guessExpenseCategory("Caddie")).toBe("caddie");
    expect(guessExpenseCategory("Lunch at the turn")).toBe("food");
    expect(guessExpenseCategory("Bar tab")).toBe("drinks");
    expect(guessExpenseCategory("Range balls")).toBe("practice");
    expect(guessExpenseCategory("Trophy engraving")).toBe("prize");
  });

  it("keeps the bar apart from the meal, because some people do not drink", () => {
    /**
     * Ajay, 2026-09-19. The bar is the one cost on a golf weekend that
     * regularly belongs to a different set of people from the dinner, and one
     * category hid that: "Food and drinks £420" tells a non-drinker nothing
     * about what they are being asked to pay for.
     *
     * The split reports it; the per-line share picker is what makes it fair.
     */
    expect(guessExpenseCategory("Dinner")).toBe("food");
    expect(guessExpenseCategory("Beers after")).toBe("drinks");
    expect(guessExpenseCategory("Pints at the nineteenth")).toBe("drinks");
    expect(guessExpenseCategory("Sandwiches at the turn")).toBe("food");
  });

  it("files the evening as itself, not as Other", () => {
    /**
     * Ajay's case, 2026-09-19: a few members go to a casino and share what it
     * cost. A trip has an evening as surely as it has green fees, and filing
     * it under "Other" is how a category stops adding up to anything.
     *
     * A COST, NOT A BET. Hard rule 7: this app records money and never moves
     * it, so this is a line somebody paid, exactly like dinner.
     */
    expect(guessExpenseCategory("Casino")).toBe("entertainment");
    expect(guessExpenseCategory("Poker night")).toBe("entertainment");
    expect(guessExpenseCategory("Tickets for the races")).toBe("entertainment");
    expect(guessExpenseCategory("Bowling after dinner")).toBe("entertainment");
  });

  it("does not match inside a longer word — the case a golf ledger will hit", () => {
    /**
     * "Carnoustie" contains "cart" and is a golf course, so an `includes`
     * check would file a green fee at Carnoustie under cart fees. The other
     * two are the same trap in words a club actually writes.
     */
    expect(guessExpenseCategory("Carnoustie")).not.toBe("cart");
    expect(guessExpenseCategory("Gaslight Inn")).toBe("lodging");
    expect(guessExpenseCategory("Barbecue")).not.toBe("food");
  });

  it("prefers the longer phrase where two could match", () => {
    // "green fee" beats "fee"; "halfway house" beats "house" having no rule.
    expect(guessExpenseCategory("Green fee and cart")).toBe("green-fee");
    expect(guessExpenseCategory("Halfway house")).toBe("food");
  });

  it("says nothing rather than guessing when it has no idea", () => {
    // "" is not "other": a caller can tell "no opinion" from a deliberate
    // filing, which is what keeps the picker honest.
    expect(guessExpenseCategory("")).toBe("");
    expect(guessExpenseCategory("   ")).toBe("");
    expect(guessExpenseCategory("Sundries for the weekend")).toBe("");
  });

  it("only ever returns a category the app offers", () => {
    for (const text of ["buggy", "hotel", "petrol", "caddy", "beers", "prizes", "nothing here"]) {
      const g = guessExpenseCategory(text);
      expect(g === "" || isExpenseCategory(g), text).toBe(true);
    }
  });

  it("is case and punctuation insensitive", () => {
    expect(guessExpenseCategory("BUGGIES!")).toBe("cart");
    expect(guessExpenseCategory("Hotel — two nights")).toBe("lodging");
  });
});

describe("what the category is for", () => {
  it("adds the lines up, which is the question a society asks", () => {
    const totals = totalsByCategory([
      { category: "lodging", amountCents: 12000 },
      { category: "cart", amountCents: 4001 },
      { category: "lodging", amountCents: 8000 },
      { category: "", amountCents: 500 },
    ]);
    expect(totals[0]).toEqual({ category: "lodging", label: "Lodging", cents: 20000 });
    // An unfiled line is Other rather than a category of its own.
    expect(totals.find((t) => t.category === "other")?.cents).toBe(500);
  });
});
