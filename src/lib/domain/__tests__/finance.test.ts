import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  addMonths, convertRow, costCsv, decimalText, grossMargin, isDay, isMonth, microsFromText, microsText, monthOfInstant,
  monthReport, monthRange, monthsBetween, originalText, rateOn, sliceFor, spreadEvenly, sumMinor, toUsdMinor, totalsByCurrency,
  usdText, COST_CSV_HEADER, type CostRow, type Rate,
} from "../finance";
import { readCostBoxes, readRateBoxes } from "../finance-input";
import { minorUnitsFrom } from "../money-format";
import { csvCell } from "../csv-export";

/**
 * THE OWNER'S BOOKS: THE ARITHMETIC (B44).
 *
 * Every figure below is WORKED BY HAND, in whole numbers, from the rule it states — not by running the
 * function and pasting what it said. The properties then hold the same rules over thousands of inputs:
 * a year's slices add back to the year, a total is the sum of its rounded rows in any order, a currency
 * is never mixed into another, and an old month does not move when a later rate is typed.
 */

const cost = (over: Partial<CostRow>): CostRow => ({
  id: "c1", month: "2026-09", category: "hosting", vendor: "zz-vendor", currency: "USD", amountMinor: 2000, cadence: "monthly",
  endsMonth: null, source: "typed", note: "", enteredByEmail: "owner@example.invalid", ...over,
});
const rate = (currency: string, rateDate: string, usdMicrosPerUnit: number, source = "override"): Rate => ({ currency, rateDate, usdMicrosPerUnit, source });

describe("spreading an amount over months", () => {
  it("100 over 3 is 33, 34, 33: each boundary rounded once, and the slices add back to 100", () => {
    // Running shares: 100/3 = 33.33 -> 33; 200/3 = 66.67 -> 67; 300/3 = 100. Slices 33, 67-33, 100-67.
    expect(spreadEvenly(100, 3)).toEqual([33, 34, 33]);
  });
  it("a year of 175000 (a plan priced 1,750.00) is twelve slices that add to exactly 175000", () => {
    const s = spreadEvenly(175000, 12);
    expect(s).toHaveLength(12);
    expect(sumMinor(s)).toBe(175000);
    // 175000 / 12 = 14583.33: every slice is 14583 or 14584.
    expect(new Set(s)).toEqual(new Set([14583, 14584]));
  });
  it("a refund spreads as the exact negative of the charge", () => {
    expect(spreadEvenly(-100, 3)).toEqual(spreadEvenly(100, 3).map((n) => -n));
  });
  it("refuses a float and a spread over nothing", () => {
    expect(() => spreadEvenly(10.5, 3)).toThrow();
    expect(() => spreadEvenly(10, 0)).toThrow();
  });
  it("property: slices add back to the total exactly and are never more than one apart", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), fc.integer({ min: 1, max: 36 }), (total, parts) => {
        const s = spreadEvenly(total, parts);
        expect(s).toHaveLength(parts);
        expect(sumMinor(s)).toBe(total);
        expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
      }),
      { numRuns: 500 },
    );
  });
});

describe("a cost across the months", () => {
  it("once is its own month and no other", () => {
    const c = cost({ cadence: "once", month: "2026-10", amountMinor: 700 });
    expect(sliceFor(c, "2026-09")).toBeNull();
    expect(sliceFor(c, "2026-10")).toBe(700);
    expect(sliceFor(c, "2026-11")).toBeNull();
  });
  it("monthly runs from its first month to its last, and on while it has none", () => {
    const c = cost({ cadence: "monthly", month: "2026-09", endsMonth: "2026-11", amountMinor: 2000 });
    expect([ "2026-08", "2026-09", "2026-11", "2026-12" ].map((m) => sliceFor(c, m))).toEqual([null, 2000, 2000, null]);
    expect(sliceFor(cost({ endsMonth: null }), "2031-01")).toBe(2000);
  });
  it("yearly: twelve slices that add to the year, then the next year again", () => {
    const c = cost({ cadence: "yearly", month: "2026-01", amountMinor: 12_001 });
    const year = monthRange("2026-01", "2026-12").map((m) => sliceFor(c, m)!);
    expect(sumMinor(year)).toBe(12_001);
    expect(sliceFor(c, "2025-12")).toBeNull();
    expect(monthRange("2027-01", "2027-12").map((m) => sliceFor(c, m)!)).toEqual(year);
  });
  it("months add and subtract, across a year end", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2027-01", -2)).toBe("2026-11");
    expect(monthsBetween("2026-11", "2027-02")).toBe(3);
    expect(monthRange("2026-11", "2027-01")).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(monthRange("2026-11", "2026-09")).toEqual([]);
    expect(monthOfInstant(new Date(Date.UTC(2026, 10, 30, 23, 59)))).toBe("2026-11");
  });
  it("knows a month and a day when it sees one", () => {
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-1")).toBe(false);
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2100-02-29")).toBe(false);
  });
});

describe("converting to US dollars at a dated rate", () => {
  it("39.00 GBP at 1.27 is $49.53 (3900 x 1.27 = 4953 cents)", () => {
    expect(toUsdMinor(3900, "GBP", 1_270_000)).toBe(4953);
  });
  it("10,000 yen at 0.0067 is $67.00: a currency with no minor digits is not read as hundredths", () => {
    expect(toUsdMinor(10_000, "JPY", 6_700)).toBe(6700);
  });
  it("a half is taken away from zero, and a refund is exactly the negative of its charge", () => {
    // 50 x 1.01 = 50.5 cents.
    expect(toUsdMinor(50, "GBP", 1_010_000)).toBe(51);
    expect(toUsdMinor(-50, "GBP", 1_010_000)).toBe(-51);
    // 89,900 rand-cents x 0.055 = 4944.5 cents.
    expect(toUsdMinor(89_900, "ZAR", 55_000)).toBe(4945);
  });
  it("US dollars are themselves", () => {
    expect(toUsdMinor(123_456, "USD", 1_000_000)).toBe(123_456);
  });
  it("property: a refund is the negative of its charge, in any rate", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }), fc.integer({ min: 1, max: 5_000_000 }), fc.constantFrom("USD", "GBP", "EUR", "JPY", "ZAR"), (n, micros, cur) => {
        expect(toUsdMinor(-n, cur, micros) + toUsdMinor(n, cur, micros)).toBe(0);
      }),
      { numRuns: 500 },
    );
  });

  it("the rate is the latest dated on or before the day; an owner's beats a published one on the same day", () => {
    const rates = [rate("GBP", "2026-09-01", 1_200_000, "ecb"), rate("GBP", "2026-09-15", 1_250_000, "ecb"), rate("GBP", "2026-09-15", 1_300_000, "override"), rate("GBP", "2026-10-20", 1_400_000, "ecb")];
    expect(rateOn(rates, "GBP", "2026-08-31")).toBeNull();
    expect(rateOn(rates, "GBP", "2026-09-10")?.usdMicrosPerUnit).toBe(1_200_000);
    expect(rateOn(rates, "GBP", "2026-09-15")?.usdMicrosPerUnit).toBe(1_300_000);
    expect(rateOn(rates, "gbp", "2026-10-01")?.usdMicrosPerUnit).toBe(1_300_000);
    expect(rateOn(rates, "EUR", "2026-10-01")).toBeNull();
    expect(rateOn([], "USD", "2026-10-01")?.usdMicrosPerUnit).toBe(1_000_000);
  });
  it("a row with no rate is not converted, and not turned into zero", () => {
    expect(convertRow({ currency: "GBP", amountMinor: 3900 }, [], "2026-10-01")).toBeNull();
    const line = convertRow({ currency: "GBP", amountMinor: 3900 }, [rate("GBP", "2026-09-15", 1_270_000)], "2026-10-01")!;
    expect(line.usdMinor).toBe(4953);
    expect(line.rate.rateDate).toBe("2026-09-15");
  });
});

describe("totals are per currency, never mixed", () => {
  it("1000 pence and 1000 cents stay two totals", () => {
    expect(totalsByCurrency([{ currency: "GBP", amountMinor: 1000 }, { currency: "USD", amountMinor: 1000 }, { currency: "gbp", amountMinor: 250 }])).toEqual({ GBP: 1250, USD: 1000 });
  });
  it("property: each currency's total is the sum of that currency's rows alone", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ currency: fc.constantFrom("USD", "GBP", "EUR"), amountMinor: fc.integer({ min: -1_000_000, max: 1_000_000 }) }), { maxLength: 40 }), (rows) => {
        const totals = totalsByCurrency(rows);
        for (const code of ["USD", "GBP", "EUR"]) {
          const mine = rows.filter((r) => r.currency === code);
          expect(totals[code]).toBe(mine.length === 0 ? undefined : mine.reduce((a, r) => a + r.amountMinor, 0));
        }
      }),
    );
  });
  it("refuses a float amount rather than rounding it", () => {
    expect(() => sumMinor([1, 2.5])).toThrow();
    expect(() => totalsByCurrency([{ currency: "USD", amountMinor: Number.NaN }])).toThrow();
  });
});

describe("a month's report", () => {
  const rates = [rate("GBP", "2026-09-15", 1_250_000)];
  const costs = [
    cost({ id: "h", category: "hosting", cadence: "monthly", month: "2026-09", amountMinor: 2000, currency: "USD" }),
    cost({ id: "d", category: "database", cadence: "once", month: "2026-10", amountMinor: 1000, currency: "GBP" }),
  ];
  it("October: hosting $20.00 plus 10.00 GBP at 1.25 ($12.50) is $32.50, with the pounds kept beside it", () => {
    const r = monthReport(costs, rates, "2026-10");
    expect(r.usdMinor).toBe(3250);
    expect(r.byCurrency).toEqual({ GBP: 1000, USD: 2000 });
    expect(r.byCategory).toEqual({ hosting: 2000, database: 1250 });
    const pounds = r.lines.find((l) => l.currency === "GBP")!;
    expect(pounds.usd?.rate).toMatchObject({ rateDate: "2026-09-15", usdMicrosPerUnit: 1_250_000 });
    expect(r.incomplete).toBe(false);
  });
  it("September has no database entered: incomplete, said by name", () => {
    const r = monthReport(costs, rates, "2026-09");
    expect(r.missingCategories).toEqual(["database"]);
    expect(r.incomplete).toBe(true);
  });
  it("a month with no cost at all is incomplete on both required lines, and costs nothing", () => {
    const r = monthReport(costs, rates, "2026-08");
    expect(r.missingCategories).toEqual(["hosting", "database"]);
    expect(r.usdMinor).toBe(0);
  });
  it("a currency with no rate is named, left out of the dollars (not made zero), and the month is incomplete", () => {
    const r = monthReport(costs, [], "2026-10");
    expect(r.usdMinor).toBe(2000);
    expect(r.noRate).toEqual([{ currency: "GBP", day: "2026-10-01" }]);
    expect(r.incomplete).toBe(true);
    expect(r.byCurrency.GBP).toBe(1000);
  });
  it("property: an old month does not move when a later rate is typed", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3_000_000 }), (laterMicros) => {
        const before = monthReport(costs, rates, "2026-10");
        const after = monthReport(costs, [...rates, rate("GBP", "2026-10-02", laterMicros), rate("GBP", "2026-11-01", laterMicros)], "2026-10");
        expect(after.usdMinor).toBe(before.usdMinor);
      }),
      { numRuns: 200 },
    );
  });
  it("property: the month's dollars are the sum of its rounded lines, whatever order they come in", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ amountMinor: fc.integer({ min: 0, max: 5_000_000 }), currency: fc.constantFrom("USD", "GBP", "EUR", "JPY") }), { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 100_000, max: 2_000_000 }),
        (rows, micros) => {
          const rs = ["GBP", "EUR", "JPY"].map((c) => rate(c, "2026-01-01", micros));
          const list = rows.map((r, i) => cost({ id: `c${i}`, category: "tools", cadence: "once", month: "2026-10", ...r }));
          const forward = monthReport(list, rs, "2026-10");
          const backward = monthReport([...list].reverse(), rs, "2026-10");
          const expected = rows.reduce((sum, r) => sum + toUsdMinor(r.amountMinor, r.currency, r.currency === "USD" ? 1_000_000 : micros), 0);
          expect(forward.usdMinor).toBe(expected);
          expect(backward.usdMinor).toBe(forward.usdMinor);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("margin", () => {
  it("no revenue record means no margin: never a negative worked from nothing", () => {
    expect(grossMargin(null, 5000, true)).toEqual({ state: "none", marginMinor: null, basisPoints: null });
  });
  it("$100.00 revenue less $60.00 cost is $40.00, 40.00 percent; partial when the month is incomplete", () => {
    expect(grossMargin(10_000, 6000, true)).toEqual({ state: "clean", marginMinor: 4000, basisPoints: 4000 });
    expect(grossMargin(10_000, 6000, false).state).toBe("partial");
  });
  it("costs above revenue are a negative margin; zero revenue has no percent", () => {
    expect(grossMargin(3000, 4500, true)).toMatchObject({ marginMinor: -1500, basisPoints: -5000 });
    expect(grossMargin(0, 4500, true)).toMatchObject({ marginMinor: -4500, basisPoints: null });
  });
  it("property: margin plus cost is revenue", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), fc.integer({ min: 0, max: 1_000_000_000 }), (rev, cst) => {
        expect(grossMargin(rev, cst, true).marginMinor! + cst).toBe(rev);
      }),
    );
  });
});

describe("typed figures and how they are written", () => {
  it("a rate is dollars per unit, dot decimal, up to six places", () => {
    expect(microsFromText("1.27")).toBe(1_270_000);
    expect(microsFromText("0.0067")).toBe(6700);
    expect(microsFromText(" 2 ")).toBe(2_000_000);
    for (const bad of ["", "0", "0.000000", "abc", "1,27", "-1", "1.1234567", "1e3"]) expect(microsFromText(bad)).toBeNull();
    expect(microsText(1_270_000)).toBe("1.270000");
    expect(microsText(6700)).toBe("0.006700");
  });
  it("amounts are written from whole minor units, never through a float", () => {
    expect(decimalText(-1250, "USD")).toBe("-12.50");
    expect(decimalText(5, "USD")).toBe("0.05");
    expect(decimalText(1_234_567, "JPY")).toBe("1234567");
    expect(usdText(123_456_789)).toBe("$1,234,567.89");
    expect(usdText(-1250)).toBe("-$12.50");
    expect(originalText(3900, "GBP")).toBe("GBP 39.00");
    expect(originalText(1_234_567, "JPY")).toBe("JPY 1,234,567");
  });
  it("property: what is written reads back as the same amount, in a currency with and without minor digits", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000_000_000, max: 100_000_000_000 }), fc.constantFrom("USD", "GBP", "JPY"), (n, cur) => {
        expect(minorUnitsFrom(decimalText(n, cur), cur)).toBe(n);
      }),
      { numRuns: 500 },
    );
  });
});

describe("the CSV", () => {
  it("a cell a spreadsheet would read as a formula is made text, by the app's one escaper; a negative figure stays a figure", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    for (const lead of ["=", "+", "-", "@"]) expect(csvCell(`${lead}A1+1`).startsWith("'")).toBe(true);
    expect(csvCell(decimalText(-1250, "USD"))).toBe("-12.50");
  });
  it("one row per month and cost, numbers written as figures, a missing rate said and not hidden, no club or id", () => {
    const rates = [rate("GBP", "2026-09-15", 1_250_000)];
    const costs = [
      cost({ id: "secret-id-1", vendor: "=cmd|' /c calc'!A1", cadence: "once", month: "2026-10", amountMinor: 1000, currency: "GBP", category: "database" }),
      cost({ id: "secret-id-2", cadence: "once", month: "2026-10", amountMinor: 700, currency: "EUR", category: "tools" }),
    ];
    const csv = costCsv([monthReport(costs, rates, "2026-10")]);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(COST_CSV_HEADER.join(","));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("2026-10,cost,Database,'=cmd|' /c calc'!A1,GBP,10.00,1.250000,2026-09-15,override,12.50,typed,owner@example.invalid");
    expect(lines[2]).toBe("2026-10,cost,Tools,zz-vendor,EUR,7.00,,,no rate,,typed,owner@example.invalid");
    expect(csv).not.toContain("secret-id");
  });
});

describe("what the owner types is read by one reader", () => {
  const boxes = { month: "2026-11", category: "database", vendor: " zz-vendor ", currency: "EUR", amount: "12,50", cadence: "monthly", endsMonth: "", note: "" };
  it("reads a comma-decimal amount in the chosen currency, trims, and keeps whole minor units", () => {
    expect(readCostBoxes(boxes)).toEqual({ ok: true, value: { month: "2026-11", category: "database", vendor: "zz-vendor", currency: "EUR", amountMinor: 1250, cadence: "monthly", endsMonth: null, note: "" } });
    expect(readCostBoxes({ ...boxes, currency: "JPY", amount: "1500" })).toMatchObject({ ok: true, value: { amountMinor: 1500 } });
    expect(readCostBoxes({ ...boxes, amount: "0" })).toMatchObject({ ok: true, value: { amountMinor: 0 } });
  });
  it("refuses what is not a cost, in words", () => {
    const refused = (over: Partial<typeof boxes>) => {
      const r = readCostBoxes({ ...boxes, ...over });
      return r.ok ? "" : r.error;
    };
    expect(refused({ amount: "abc" })).toMatch(/figure/);
    expect(refused({ amount: "-5" })).toMatch(/less than nothing/);
    expect(refused({ amount: "999999999999" })).toMatch(/too large/);
    expect(refused({ month: "Nov 2026" })).toMatch(/month/);
    expect(refused({ category: "yachts" })).toMatch(/what the cost is for/);
    expect(refused({ category: "other" })).toMatch(/Other/);
    expect(refused({ currency: "ABC" })).toMatch(/currency/);
    expect(refused({ cadence: "weekly" })).toMatch(/once, monthly or yearly/);
    expect(refused({ cadence: "once", endsMonth: "2027-01" })).toMatch(/once has no last month/);
    expect(refused({ endsMonth: "2026-10" })).toMatch(/before the first/);
  });
  it("a rate needs a currency that is not dollars, a real day, a figure and a reason", () => {
    const ok = { currency: "gbp", day: "2026-11-01", rate: "1.27", reason: "bank statement" };
    expect(readRateBoxes(ok)).toEqual({ ok: true, value: { currency: "GBP", rateDate: "2026-11-01", usdMicrosPerUnit: 1_270_000, reason: "bank statement" } });
    for (const over of [{ currency: "USD" }, { day: "2026-02-30" }, { rate: "one" }, { reason: " " }]) {
      expect(readRateBoxes({ ...ok, ...over }).ok).toBe(false);
    }
  });
});
