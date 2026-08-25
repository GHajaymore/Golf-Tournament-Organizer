import { describe, it, expect } from "vitest";
import { money, currencySymbol, minorUnitDigits, CURRENCIES, DEFAULT_CURRENCY } from "@/lib/domain/money-format";

/**
 * Writing an amount for a club anywhere.
 *
 * The assertion that matters most is the YEN one. Every amount in this app is
 * stored in minor units and twelve separate formatters divided by a hundred —
 * correct for dollars and pounds, and wrong by a factor of a hundred for a
 * currency with no minor unit. A club in Tokyo would have read every prize at
 * a hundredth of its value and assumed they had typed it in wrong.
 */
describe("writing money for a club's own currency", () => {
  it("defaults to dollars, which is what every existing row already means", () => {
    expect(DEFAULT_CURRENCY).toBe("USD");
    expect(money(2250)).toBe("$22.50");
    expect(money(0)).toBe("$0.00");
  });

  it("writes the club's own currency", () => {
    expect(money(2250, "GBP")).toBe("£22.50");
    expect(money(2250, "EUR")).toBe("€22.50");
    // The ambiguous ones are disambiguated, which is the point of a code.
    expect(money(2250, "CAD")).toBe("CA$22.50");
    expect(money(2250, "AUD")).toBe("A$22.50");
  });

  it("HANDLES A CURRENCY WITH NO MINOR UNIT", () => {
    // 100 stored is one dollar and also one hundred yen. Dividing by a
    // hundred regardless is the silent hundred-fold error.
    expect(minorUnitDigits("JPY")).toBe(0);
    expect(money(100, "JPY")).toBe("¥100");
    expect(money(2250, "JPY")).toBe("¥2,250");
    // And the ordinary case still divides.
    expect(minorUnitDigits("USD")).toBe(2);
    expect(money(100, "USD")).toBe("$1.00");
  });

  it("falls back rather than throwing on a bad row", () => {
    // A money screen must not go down because a column holds nonsense.
    expect(money(2250, "NOTACURRENCY")).toBe("$22.50");
    expect(money(2250, "")).toBe("$22.50");
    expect(currencySymbol("NOTACURRENCY")).toBe("$");
    // A non-finite amount is zero rather than "NaN" on a settle-up screen.
    expect(money(Number.NaN, "USD")).toBe("$0.00");
  });

  it("takes the code however it was stored", () => {
    expect(money(2250, "gbp")).toBe("£22.50");
  });

  it("offers a symbol derived from the code, never stored beside it", () => {
    // Stored separately they drift, and a club showing "£" while rounding to
    // USD's decimals would look right and be wrong.
    expect(currencySymbol("GBP")).toBe("£");
    expect(currencySymbol("JPY")).toBe("¥");
    expect(currencySymbol("USD")).toBe("$");
  });

  it("formats every currency it offers in the picker", () => {
    for (const c of CURRENCIES) {
      const out = money(12345, c.code);
      expect(out, `${c.code} produced nothing`).toBeTruthy();
      expect(out).not.toContain("NaN");
      // Every offered currency must carry a real label for the picker.
      expect(c.label.length).toBeGreaterThan(3);
    }
  });
});
