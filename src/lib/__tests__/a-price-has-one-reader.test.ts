import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { PLANS, PLAN_CURRENCIES } from "@/lib/plans";
import { stripComments } from "./source";

/**
 * A PRICE HAS ONE READER (Ajay, 2026-11-10: the Plans panel on /owner is the ONE
 * place every plan figure is adjusted, so nothing else may hold a copy).
 *
 * Two copies this refuses, in everything that ships (comments aside):
 *
 *   - a plan's own default read raw (`.priceMonthly`, `.localMonthly`) anywhere but
 *     the file that defines it and the owner's editor, which needs the default to
 *     show what blank means. Every other screen quotes through `planQuote`
 *     (`effectivePrice`, `effectiveAnnualPrice`), which honours the owner's region;
 *   - a plan's price typed into the code as a figure with a currency mark ("$49",
 *     "£139"): a number the owner can change and the screen then contradicts.
 */

const SRC = join(process.cwd(), "src");
const files = (d: string): string[] =>
  readdirSync(d).flatMap((e) => {
    const p = join(d, e);
    if (statSync(p).isDirectory()) return e === "__tests__" ? [] : files(p);
    return /\.(ts|tsx)$/.test(p) && !p.endsWith(".data.ts") ? [p] : [];
  });

/** Where a default may be read raw: the definition, and the editor/validator that show or check against it. */
const MAY_READ_DEFAULTS = new Set(["lib/plans.ts", "lib/domain/plan-edit.ts", "app/owner/page.tsx"]);

const RAW_DEFAULT = /\.(priceMonthly|localMonthly)\b/;

/** Every figure a plan is priced at by default, in any currency. */
function planFigures(): number[] {
  const out = new Set<number>();
  for (const p of Object.values(PLANS)) {
    if (p.priceMonthly > 0) out.add(p.priceMonthly);
    for (const c of PLAN_CURRENCIES) if (c !== "USD" && p.localMonthly[c] > 0) out.add(p.localMonthly[c]);
  }
  return [...out];
}

/** A currency mark directly before a plan's figure: "$49", "£139", "R3,199", "US$175". */
export function typedPrice(code: string, figures: number[]): string | null {
  const text = stripComments(code);
  for (const n of figures) {
    const withComma = n.toLocaleString("en-US");
    const m = text.match(new RegExp(`(?:[$£€]|R)\\s?(?:${n}|${withComma})(?![\\d,])`));
    if (m) return m[0];
  }
  return null;
}

describe("a price has one reader", () => {
  const all = files(SRC).map((f) => ({ rel: relative(SRC, f).split(sep).join("/"), code: readFileSync(f, "utf8") }));

  it("no screen reads a plan's default price raw", () => {
    const hits = all.filter((f) => !MAY_READ_DEFAULTS.has(f.rel) && RAW_DEFAULT.test(stripComments(f.code))).map((f) => f.rel);
    expect(hits, "quote through planQuote / effectivePrice (plans.ts) so the owner's region prices reach it").toEqual([]);
  });

  it("no screen types a plan's price into its words", () => {
    const hits = all.map((f) => ({ rel: f.rel, hit: typedPrice(f.code, planFigures()) })).filter((f) => f.hit);
    expect(hits, "a plan price in the code is a second copy of the owner's number").toEqual([]);
  });

  it("CONTROL: the sweep sees both", () => {
    expect(RAW_DEFAULT.test("const p = PLANS.club.priceMonthly;")).toBe(true);
    expect(RAW_DEFAULT.test("const p = effectivePrice(PLANS.club, o, c);")).toBe(false);
    expect(typedPrice("<p>Eagle is $175 a month</p>", planFigures())).toBe("$175");
    expect(typedPrice("<p>Eagle is £139 a month</p>", planFigures())).toBe("£139");
    expect(typedPrice("<p>R3,199 a month</p>", planFigures())).toBe("R3,199");
    expect(typedPrice("// Eagle is $175 a month\nconst x = 1;", planFigures())).toBeNull();
    expect(typedPrice("<p>{money(1750)}</p>", planFigures())).toBeNull();
  });
});
