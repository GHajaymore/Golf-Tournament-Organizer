import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";

/**
 * MONEY WRITTEN INTO THE CHANGE LOG GOES THROUGH `money(cents, currency)`
 * (2026-10-07).
 *
 * Recent changes on a casual round's Export page read "Skins at 500c a head".
 * Four server actions wrote a stake into the log by hand: two as raw minor
 * units with a "c", two as a bare `(cents / 100).toFixed(2)` with no symbol —
 * which is also wrong for a currency with no minor unit, where 500 yen is
 * "¥500", not "5.00". `expenses.ts` already did it right, through
 * `money-format.ts` with the event's currency.
 *
 * So the hand-made spellings are refused across every action, and the four
 * that had them must reach the formatter with the event's currency.
 */

const DIR = "src/app/actions";
const actions = readdirSync(DIR)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => `${DIR}/${f}`);

const HAND_MADE = [
  /c a head/, // "500c a head"
  /\/\s*100\s*\)?\s*\.toFixed\(/, // `(cents / 100).toFixed(2)`
  // A local formatter that takes no currency. `expenses.ts` keeps a local
  // `money(cents, currency)` that wraps the real one, and that is fine.
  /const money\s*=\s*\(\s*\w+\s*(:\s*number\s*)?\)\s*=>/,
];

describe("money in the change log is formatted for the event's currency", () => {
  it("CONTROL: the sweep reads the actions, and the patterns catch what they are for", () => {
    expect(actions.length).toBeGreaterThan(20);
    expect(HAND_MADE.some((re) => re.test("`set to ${buyIn}c a head`"))).toBe(true);
    expect(HAND_MADE.some((re) => re.test("const money = (cents: number) => `${(cents / 100).toFixed(2)}`;"))).toBe(true);
    expect(HAND_MADE.some((re) => re.test("const money = (cents: number) => fmt(cents);"))).toBe(true);
    expect(HAND_MADE.some((re) => re.test("`at ${money(cents, await currencyForEvent(eventId))}`"))).toBe(false);
    expect(HAND_MADE.some((re) => re.test("const money = (cents: number, currency: string) => fmtMoney(cents, currency);"))).toBe(false);
  });

  it("no action spells money by hand", () => {
    const offenders = actions.flatMap((f) => {
      const src = readSource(f);
      return HAND_MADE.filter((re) => re.test(src)).map((re) => `${f}: ${re}`);
    });
    expect(offenders).toEqual([]);
  });

  it.each(["skins.ts", "match-setup.ts", "side-games.ts", "contests.ts"])(
    "%s formats its stake with the event's currency",
    (file) => {
      const src = readSource(`${DIR}/${file}`);
      expect(src).toMatch(/from "@\/lib\/domain\/money-format"/);
      expect(src).toMatch(/money\([^)]*currencyForEvent\(/);
    },
  );
});
