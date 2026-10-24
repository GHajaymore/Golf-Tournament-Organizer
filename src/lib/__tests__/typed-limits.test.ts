import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSource } from "./source";
import { EMAIL_MAX, isEmailAddress, nameRefusal, PERSON_NAME_MAX, SIDE_NAME_MAX } from "@/lib/domain/typed-limits";
import { moneyBoxRefusal, minorUnitsFrom } from "@/lib/domain/money-format";
import { prizeAmountRefusal, PRIZE_AMOUNT_MAX } from "@/lib/domain/prize-amount";
import { MAX_EXPENSE_CENTS } from "@/lib/domain/expenses";

/**
 * WHAT A TEXT BOX MAY HOLD — the rules the text-box crawl found missing
 * (`e2e/every-text-box.spec.ts`, 2026-10-21), held where they are written.
 * The actions are asked the same questions against real rows in
 * `what-a-text-box-may-hold.audit.test.ts`.
 */

describe("an address", () => {
  it("is refused with no @, with markup, with a space, or as a list", () => {
    for (const bad of [
      "zz-text-box-not-an-address-9",
      "<b>zz-tbx</b>zz-text-box@example.invalid",
      "zz text@example.invalid",
      "zz@example",
      "a@example.invalid, b@example.invalid",
      'zz"quoted"@example.invalid',
      `${"z".repeat(EMAIL_MAX)}@example.invalid`,
    ]) {
      expect(isEmailAddress(bad), bad.slice(0, 40)).toBe(false);
    }
  });

  it("CONTROL: real shapes of address pass, an apostrophe and a plus included", () => {
    for (const good of ["zz@example.invalid", "zz.o'brien@example.invalid", "zz+golf@mail.example.invalid", "ZZ@EXAMPLE.INVALID"]) {
      expect(isEmailAddress(good), good).toBe(true);
    }
  });
});

describe("a name", () => {
  it("blank is the screen's own sentence; too long says the limit", () => {
    expect(nameRefusal("", PERSON_NAME_MAX, "Enter a player name.")).toBe("Enter a player name.");
    expect(nameRefusal("z".repeat(PERSON_NAME_MAX + 1), PERSON_NAME_MAX, "x")).toBe(`Keep the name to ${PERSON_NAME_MAX} characters.`);
    expect(nameRefusal("z".repeat(PERSON_NAME_MAX), PERSON_NAME_MAX, "x")).toBeNull();
  });

  it("a side can hold the name the app gives a pair: two people's names and an ampersand", () => {
    expect(`${"z".repeat(PERSON_NAME_MAX)} & ${"z".repeat(PERSON_NAME_MAX)}`.length).toBeLessThanOrEqual(SIDE_NAME_MAX);
  });
});

describe("a money box, before it is sent", () => {
  const read = (text: string) => moneyBoxRefusal(text, minorUnitsFrom(text, "GBP", "en-GB"), MAX_EXPENSE_CENTS);

  it("refuses no figure, less than nothing, and a figure too long to be one", () => {
    expect(read("abc")).toMatch(/figure/);
    expect(read("⛳")).toMatch(/figure/);
    expect(read("")).toMatch(/figure/);
    expect(read("-5")).toMatch(/less than nothing/);
    // Four hundred nines: the reader makes it 0, and it is the LARGEST figure, not the smallest.
    expect(minorUnitsFrom("9".repeat(400), "GBP", "en-GB")).toBe(0);
    expect(read("9".repeat(400))).toMatch(/too large/);
    expect(read("1000001")).toMatch(/too large/);
  });

  it("CONTROL: a stake as people write one is not refused", () => {
    for (const ok of ["5", "0", "12.50", "£10", "1,000", "0.00"]) expect(read(ok), ok).toBeNull();
    expect(moneyBoxRefusal("5,00", minorUnitsFrom("5,00", "EUR", "de-DE"), MAX_EXPENSE_CENTS)).toBeNull();
  });
});

describe("a prize's amount", () => {
  it("refuses no figure, a negative, and past the ceiling", () => {
    expect(prizeAmountRefusal(Number.NaN)).toMatch(/figure/);
    expect(prizeAmountRefusal(-1)).toMatch(/less than nothing/);
    expect(prizeAmountRefusal(Number.NEGATIVE_INFINITY)).toMatch(/less than nothing/);
    expect(prizeAmountRefusal(1e9)).toMatch(/too large/);
    expect(prizeAmountRefusal(Number.POSITIVE_INFINITY)).toMatch(/too large/);
  });

  it("CONTROL: nothing, a sum and the ceiling itself are amounts", () => {
    for (const ok of [0, 12.5, PRIZE_AMOUNT_MAX]) expect(prizeAmountRefusal(ok), String(ok)).toBeNull();
  });
});

/** ONE SHAPE OF AN ADDRESS. Six files had their own copy of it, all too loose. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : files(p);
    return /\.(tsx?|mjs)$/.test(name) ? [p] : [];
  });
}
/** A regular expression that reads an address: "anything but a space or an @, then an @". */
const emailPattern = (src: string) => src.split("\n").filter((l) => l.includes("/^[^\\s@") && l.includes("]+@["));

/** A different QUESTION about an address, each with its reason. */
const OTHER_QUESTIONS: Record<string, string> = {
  "src/lib/domain/privacy-contact.ts":
    "asks whether to PUBLISH an address as a working contact route, not whether a person may give it — stricter on purpose, and says so",
};

describe("the shape of an address is written once", () => {
  it("only typed-limits.ts writes one", () => {
    const copies = files("src")
      .map((f) => f.replace(/\\/g, "/"))
      .filter((f) => f !== "src/lib/domain/typed-limits.ts" && !OTHER_QUESTIONS[f])
      .flatMap((f) => emailPattern(readSource(f)).map((l) => `${f}: ${l.trim()}`));
    expect(copies, copies.join("\n")).toEqual([]);
  });

  it("control: the copy that was in six files is recognised", () => {
    expect(emailPattern("const EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;")).toHaveLength(1);
    expect(emailPattern(readSource("src/lib/domain/typed-limits.ts"))).toHaveLength(1);
  });
});
