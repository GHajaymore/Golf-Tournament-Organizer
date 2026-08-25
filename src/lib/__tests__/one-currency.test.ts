import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { money, isCurrencyCode, CURRENCIES, currencySymbol } from "@/lib/domain/money-format";

/**
 * ONE way to write an amount, for a club anywhere.
 *
 * There were twelve `money()` helpers, one in nearly every screen that shows a
 * number, each hard-coding a dollar sign and dividing by a hundred. A club in
 * Britain saw dollars on all of them, and `Organization.currency` was a column
 * nothing could set.
 *
 * A hard-coded symbol is easy to write and invisible in review — it looks like
 * every other line of formatting — so the rule is enforced from the filesystem
 * rather than remembered. This is the same shape as the brand-mark and layout
 * sweeps: the next component written is covered, not just the ones fixed.
 */

const COMPONENTS = join(process.cwd(), "src", "components");

/** Files that legitimately name a currency: the formatter and its provider. */
const ALLOWED = new Set(["CurrencyProvider.tsx", "CurrencyPicker.tsx"]);

describe("no screen writes its own currency", () => {
  const files = readdirSync(COMPONENTS).filter((f) => f.endsWith(".tsx") && !ALLOWED.has(f));

  it("finds the components", () => {
    // A broken read would make the sweep below vacuous.
    expect(files.length).toBeGreaterThan(20);
  });

  it("has no local money() helper with a symbol baked into it", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(COMPONENTS, f), "utf8");
      // A formatter declared in the file AND a currency symbol on the same
      // line: `const money = (c) => `$${(c / 100).toFixed(2)}``.
      for (const line of src.split("\n")) {
        // A LITERAL currency symbol — `$` that is not opening a template
        // interpolation. Written as a bare `[$…]` this flagged
        // `` `${fmt(cents)}` `` , which is the fix rather than the fault: a
        // guard that fails correct code is the one people delete.
        if (/^\s*(const|function)\s+money\b/.test(line) && /[£€¥₹]|\$(?!\{)/.test(line)) {
          offenders.push(`${f}: ${line.trim().slice(0, 70)}`);
        }
      }
    }
    expect(offenders, `write amounts with useMoney() instead:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("divides by a hundred nowhere", () => {
    // The other half of the same mistake, and the one that survives a symbol
    // fix: not every currency has a hundred minor units. `money()` asks Intl
    // how many there are; `/ 100` assumes.
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(COMPONENTS, f), "utf8");
      src.split("\n").forEach((line, i) => {
        if (/\/\s*100\s*\)\s*\.toFixed\(2\)/.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders, `these assume a hundred minor units:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("the formatter answers for a club anywhere", () => {
  it("writes the same stored number differently per currency", () => {
    // 100 minor units is one dollar, one pound — and one hundred yen. The
    // whole reason the code is stored rather than the symbol.
    expect(money(100, "USD")).toBe("$1.00");
    expect(money(100, "GBP")).toBe("£1.00");
    expect(money(100, "JPY")).toBe("¥100");
  });

  it("keeps a yen amount whole rather than showing a hundredth of it", () => {
    // The failure this replaces: a club in Tokyo reading every prize at a
    // hundredth of its value would assume they had typed it wrong.
    expect(money(500000, "JPY")).toBe("¥500,000");
    expect(money(500000, "USD")).toBe("$5,000.00");
  });

  it("falls back rather than throwing on a bad code", () => {
    // A bad row must not take a money screen down: showing the number in
    // dollars is recoverable, showing nothing is not.
    expect(money(100, "")).toBe("$1.00");
    expect(money(100, "NOPE")).toBe("$1.00");
    expect(() => money(100, "!!")).not.toThrow();
  });

  it("accepts every currency the picker offers", () => {
    // The guard rejected ZAR while the picker offered it, because it inferred
    // "known" from whether Intl produced a SYMBOL — and the rand is written
    // "ZAR 1.00". A guard that refuses real data is worse than no guard.
    for (const c of CURRENCIES) {
      expect(isCurrencyCode(c.code), `${c.code} is offered but refused`).toBe(true);
      expect(currencySymbol(c.code).length).toBeGreaterThan(0);
    }
  });

  it("accepts codes beyond the offered list, and refuses nonsense", () => {
    // The list is what the PICKER shows; what may be STORED is anything the
    // runtime can write, so shortening the list cannot invalidate a setting.
    for (const good of ["CHF", "SEK", "INR", "THB", "AED"]) {
      expect(isCurrencyCode(good), `${good} should be storable`).toBe(true);
    }
    for (const bad of ["", "US", "USDD", "ABC", "ZZZ", "123", "$", "  "]) {
      expect(isCurrencyCode(bad), `${JSON.stringify(bad)} should be refused`).toBe(false);
    }
  });

  it("is case-insensitive about the code", () => {
    expect(isCurrencyCode("gbp")).toBe(true);
    expect(money(100, "gbp")).toBe("£1.00");
  });
});
