import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { money, isCurrencyCode, CURRENCIES, currencySymbol, minorUnitsFrom } from "@/lib/domain/money-format";

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

describe("what somebody types is read in the club's currency", () => {
  it("reads a yen buy-in as yen, not as a hundred times one", () => {
    // The bug this replaces: every input did `parseFloat(text) * 100`, so a
    // club in Tokyo entering a ¥500 buy-in ran a pot for ¥50,000. Reading a
    // prize at a hundredth of its value is alarming and obvious; charging a
    // hundred times the stake looks deliberate.
    expect(minorUnitsFrom("500", "JPY")).toBe(500);
    expect(minorUnitsFrom("500", "USD")).toBe(50_000);
  });

  it("is the exact inverse of the formatter, in every currency offered", () => {
    // The property that makes the bug unwritable: whatever is parsed, the
    // formatter writes back to the same thing. Asked of both, so the two
    // cannot drift apart the way they did.
    for (const c of CURRENCIES) {
      for (const amount of [0, 1, 500, 12_345, 999_999]) {
        const written = money(amount, c.code);
        expect(minorUnitsFrom(written, c.code), `${c.code} round-trip of ${amount}`).toBe(amount);
      }
    }
  });

  it("takes a symbol, separators and spaces off what was pasted", () => {
    expect(minorUnitsFrom("$1,234.56", "USD")).toBe(123_456);
    expect(minorUnitsFrom("  £20 ", "GBP")).toBe(2_000);
    expect(minorUnitsFrom("¥1,000", "JPY")).toBe(1_000);
  });

  it("reads a refund as negative rather than dropping the sign", () => {
    expect(minorUnitsFrom("-40.50", "USD")).toBe(-4_050);
  });

  it("gives zero for nothing, rather than NaN", () => {
    // A NaN in a ledger is every number in it gone.
    for (const junk of ["", "   ", "abc", "$", "."]) {
      expect(Number.isFinite(minorUnitsFrom(junk, "USD")), `${JSON.stringify(junk)}`).toBe(true);
    }
    expect(minorUnitsFrom("", "USD")).toBe(0);
  });

  it("has no component multiplying typed input by a hundred", () => {
    // The filesystem half, like the two sweeps above: the next input written
    // is covered, not just the five that were fixed.
    const offenders: string[] = [];
    for (const f of readdirSync(COMPONENTS).filter((x) => x.endsWith(".tsx") && !ALLOWED.has(x))) {
      const src = readFileSync(join(COMPONENTS, f), "utf8");
      src.split("\n").forEach((line, i) => {
        if (/(parseFloat|Number)\([^)]*\)\s*\*\s*100\b/.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders, `parse typed money with useMoney().parse:\n${offenders.join("\n")}`).toEqual([]);
  });
});

/**
 * The enumerate-then-re-read shape, swept from the filesystem.
 *
 * Four readers listed the skins pots on a round and then fetched each row
 * again WITHOUT its groupKey, so every group pot resolved to the field's: the
 * club's money counted once per group pot, and every fourball's lost. The
 * 2026-08-25 audit found it four times over from four independent angles,
 * which is what a rule with many readers looks like from outside.
 *
 * `skinsPotFor` now requires the argument, so the compiler catches a fresh
 * caller. This catches the other half — a query that reads pots without
 * deciding whose they are.
 */
describe("nothing reads a skins pot without saying whose it is", () => {
  const ROOTS = [join(process.cwd(), "src", "lib", "services"), join(process.cwd(), "src", "app")];

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(e.name)) out.push(full);
    }
    return out;
  };

  it("constrains groupKey on every skinsPot query that feeds money", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        if (file.includes("__tests__")) continue;
        // COMMENTS STRIPPED FIRST. These queries carry long explanations
        // between the call and its `select`, and a fixed window over the raw
        // source cut the `groupKey` off and reported two correct readers as
        // faults. A guard that flags correct code is the one somebody deletes.
        const src = readFileSync(file, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, "");
        if (!/prisma\.skinsPot\.(findMany|findFirst)/.test(src)) continue;
        // The query must mention groupKey — either filtering to the club's
        // ("") or selecting it so the caller can pass it on.
        const calls = src.split(/prisma\.skinsPot\.(?:findMany|findFirst)/).slice(1);
        for (const call of calls) {
          const head = call.slice(0, 300);
          // `select: { id: true }` existence probes do not read money.
          if (/select:\s*\{\s*id:\s*true\s*\}/.test(head)) continue;
          if (!/groupKey/.test(head)) {
            offenders.push(file.replace(process.cwd(), ""));
          }
        }
      }
    }
    expect(
      offenders,
      `these read skins pots without deciding whose:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
