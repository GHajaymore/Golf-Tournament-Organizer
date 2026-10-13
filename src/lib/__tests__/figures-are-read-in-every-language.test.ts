import { describe, it, expect } from "vitest";
import { money, minorUnitsFrom, CURRENCIES } from "@/lib/domain/money-format";
import { LOCALES } from "@/lib/domain/locale";
import { DATE_WORD_TAGS } from "@/lib/domain/date-words";
import { decimalPoint } from "@/lib/domain/decimal-text";
import { parseHandicapInput } from "@/lib/domain/registration-intake";
import { parseHandicap } from "@/lib/domain/quick-match";
import { readSource } from "./source";

/**
 * WHAT THE APP WRITES IN A CLUB'S LANGUAGE, IT READS BACK IN THAT LANGUAGE.
 *
 * Found 2026-10-13 by the first browser test to start a side bet. The stake
 * box is filled by the formatter, in the club's locale, and read by the parser
 * — which knew the club's currency and not its locale. So for a German, French
 * or Spanish club:
 *
 *   the box shows   5,00          and it was read as   500.00
 *   the box shows   1.234,56      and it was read as   1.23
 *
 * A stake a hundred times what was typed, on the skins pot, every side bet,
 * every shared cost and every line of the kitty. Measured before the fix: 90
 * of 392 locale × currency × amount combinations read back wrong.
 *
 * `one-currency.test.ts` has held "the parser is the exact inverse of the
 * formatter, in every currency offered" for months — and formatted in en-US
 * every time. The rule ranged over two axes and the test walked one. This
 * walks both, from the app's own lists, so a language or a currency added
 * later is covered the day it is added.
 */

/** The digits a money box is filled with — `plain` in `CurrencyProvider`, spelled the same way. */
const inTheBox = (cents: number, currency: string, locale: string) => money(cents, currency, locale).replace(/[^\d.,-]/g, "").trim();
const TAGS = [...new Set([...LOCALES.map((l) => l.tag), ...DATE_WORD_TAGS])];
const AMOUNTS = [0, 1, 99, 500, 1050, 12_345, 123_456, 999_999, 100_000_000];

describe("an amount written for a club is read back as that amount", () => {
  it("in every language and currency a club can choose", () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const locale of TAGS) {
      for (const { code } of CURRENCIES) {
        for (const amount of AMOUNTS) {
          checked += 1;
          for (const written of [inTheBox(amount, code, locale), money(amount, code, locale)]) {
            const back = minorUnitsFrom(written, code, locale);
            if (back !== amount) wrong.push(`${locale} ${code}: wrote "${written}" for ${amount}, read ${back}`);
          }
        }
      }
    }
    // CONTROL: the lists are not empty, and the comma-decimal languages are among them.
    expect(checked).toBeGreaterThanOrEqual(10 * 9 * AMOUNTS.length);
    expect(TAGS).toEqual(expect.arrayContaining(["de-DE", "fr-FR", "es-ES", "en-IN", "ja-JP"]));
    expect(inTheBox(1050, "EUR", "de-DE"), "CONTROL: German no longer writes a decimal comma, so this test proves nothing").toBe("10,50");
    expect(wrong.slice(0, 20), `${wrong.length} of ${checked * 2} read back wrong`).toEqual([]);
  });

  it("a negative amount keeps its sign in every language", () => {
    for (const locale of TAGS) {
      for (const { code } of CURRENCIES) {
        const written = money(-4050, code, locale);
        expect(minorUnitsFrom(written, code, locale), `${locale} ${code} "${written}"`).toBe(-4050);
      }
    }
  });
});

describe("an amount somebody types is read the way they meant it", () => {
  const cases: Array<[string, string, number]> = [
    // typed, currency, minor units
    ["5,00", "EUR", 500],
    ["10,5", "EUR", 1050],
    ["1.234,56", "EUR", 123_456],
    ["1 234,56", "EUR", 123_456],
    ["1.000.000,00", "EUR", 100_000_000],
    ["5.00", "EUR", 500],
    ["10.5", "USD", 1050],
    ["1,234.56", "USD", 123_456],
    ["1,234", "USD", 123_400],
    ["1.234", "EUR", 123_400],
    ["1,00,000.00", "INR", 10_000_000],
    ["12,34,567", "INR", 123_456_700],
    ["1,050", "JPY", 1050],
    ["1.050", "JPY", 1050],
    ["500", "JPY", 500],
    ["5.", "USD", 500],
    [".5", "USD", 50],
    [",5", "EUR", 50],
    ["$1,234.56", "USD", 123_456],
    ["1’234.50", "USD", 123_450],
    ["-40,50", "EUR", -4050],
  ];
  it.each(cases)("%s in %s", (typed, currency, cents) => {
    // The same whichever language the club is set to: the text decides, so a
    // server and every browser read one figure one way.
    for (const locale of TAGS) expect(minorUnitsFrom(typed, currency, locale), `${typed} under ${locale}`).toBe(cents);
  });

  it("gives zero for nothing, in every language, rather than NaN", () => {
    for (const locale of TAGS) {
      for (const junk of ["", "   ", "abc", "€", ".", ",", "-", "ten"]) {
        expect(minorUnitsFrom(junk, "EUR", locale), `${JSON.stringify(junk)} under ${locale}`).toBe(0);
      }
    }
  });

  it("a currency with three decimals asks the club which mark is the decimal one", () => {
    // The one figure the text cannot settle: 1.500 dinar is one and a half in English and
    // fifteen hundred in German.
    expect(minorUnitsFrom("1.500", "KWD", "en-US")).toBe(1500);
    expect(minorUnitsFrom("1.500", "KWD", "de-DE")).toBe(1_500_000);
    expect(minorUnitsFrom("1,500", "KWD", "de-DE")).toBe(1500);
  });

  it("every money box is handed the club's language as well as its currency", () => {
    const provider = readSource("src/components/CurrencyProvider.tsx");
    expect(provider).toContain("parseMoney(text, currency, locale)");
    expect(provider).not.toContain("parseMoney(text, currency)");
    // And the one amount the SERVER reads from text — a line of the kitty.
    expect(readSource("src/app/actions/money-setup.ts")).toContain("minorUnitsFrom((input.amount ?? \"\").toString(), currency, locale)");
  });
});

describe("a handicap or a rating typed with a decimal comma is the same figure", () => {
  it("one comma between digits is a decimal mark, and nothing else is touched", () => {
    expect(decimalPoint("12,4")).toBe("12.4");
    expect(decimalPoint("+2,4")).toBe("+2.4");
    expect(decimalPoint(" 71,3 ")).toBe("71.3");
    expect(decimalPoint(",5")).toBe(".5");
    // Handed back as they came, for the reader to refuse.
    for (const left of ["12.4", "1,2,3", "12,4abc", "12,", "abc", "", "1.234,5"]) expect(decimalPoint(left), left).toBe(left);
    expect(decimalPoint(null)).toBe("");
  });

  it("the entry form and the roster take 12,4 as 12.4 — and a plus handicap still counts the right way", () => {
    expect(parseHandicapInput("12,4")).toEqual({ ok: true, value: 12.4, source: "manual" });
    expect(parseHandicapInput("+2,4")).toEqual({ ok: true, value: -2.4, source: "manual" });
    // CONTROL: nonsense is still refused, in words.
    expect(parseHandicapInput("1,2,3").ok).toBe(false);
    expect(parseHandicapInput("12,4abc").ok).toBe(false);
    expect(parseHandicapInput("99,9").ok).toBe(false);
  });

  it("a casual round no longer puts a player who typed 12,4 on scratch", () => {
    expect(parseHandicap("12,4")).toBe(12.4);
    expect(parseHandicap("+2,4")).toBe(-2.4);
    expect(parseHandicap("12.4")).toBe(12.4);
    expect(parseHandicap("")).toBe(0);
  });

  it("both course-rating boxes read a comma, so 71,3 is not stored as 71", () => {
    expect(readSource("src/components/TeeEditor.tsx")).not.toMatch(/parseFloat\(draft\.courseRating\)/);
    expect(readSource("src/components/VenuePrompt.tsx")).not.toMatch(/parseFloat\(cr\)/);
    expect(parseFloat(decimalPoint("71,3"))).toBe(71.3);
  });
});
