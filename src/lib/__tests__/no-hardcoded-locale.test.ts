import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * NOBODY WRITES A DATE OR AN AMOUNT IN AMERICAN BY ACCIDENT.
 *
 * This is the sweep for the class, not the instances. The defect it closes was
 * never one bad call — it was eleven, across six files, each one perfectly
 * reasonable where it stood: a screen needed a date, `toLocaleDateString`
 * wants a locale, and "en-US" is the one everybody types. Nothing about any
 * single line looked wrong, which is precisely why there were eleven.
 *
 * So the rule is positional rather than stylistic: the two modules that OWN
 * formatting may name a locale, and nothing else may. A screen that needs a
 * date asks `domain/locale.ts`, which asks the club.
 *
 * TWO MODULES, NOT ONE, and the second is deliberate: `money-format.ts` keeps
 * an "en-US" in its CATCH branch, as the last-resort fallback when both the
 * currency and the locale it was handed are unusable. That is the one place an
 * American default is the right answer, because the alternative is a money
 * screen that throws.
 */

const OWNERS = ["src/lib/domain/locale.ts", "src/lib/domain/money-format.ts"];

/**
 * NOT A FORMAT, SO NOT THIS RULE.
 *
 * `dictation.ts` sets `rec.lang = "en-US"` on the Web Speech recogniser. That
 * is the language somebody is SPEAKING, not the way a date is written, and
 * routing it through `formattingFor` would be pressing an unrelated answer
 * into service because both happen to be BCP-47 tags.
 *
 * It is still a real localisation question — a club in Osaka calling scores
 * into a recogniser listening for American English will get nothing useful —
 * and it is deliberately not answered here. Voice entry needs its own choice,
 * probably alongside the club's locale rather than derived from it, because
 * the language a scorer speaks and the way the club writes a date are not
 * reliably the same thing in a club with an international membership.
 */
const NOT_A_FORMAT = ["src/lib/dictation.ts"];

/**
 * EMPTY, AND THAT IS THE POINT OF KEEPING IT.
 *
 * This briefly listed `MessagesClient` and `ScoreEntryClient`, which stamped a
 * message and a signed card with whatever locale the reader's device was set
 * to. They were going to stay listed: both sit several layers below a server
 * component, so passing the club's locale down looked like threading a prop
 * through every caller and every render test.
 *
 * Then it turned out the app already had the answer. `CurrencyProvider` has
 * carried the club's CURRENCY to every screen through context since it was
 * written, for exactly this reason — its own header says "the prop somebody
 * forgets is a screen quietly back in dollars". Teaching it the locale as well
 * closed both in four lines, because the locale and the currency are one
 * decision and always were.
 *
 * The list stays so the assertion below still has something to compare
 * against: it is what makes a NEW viewer-locale format fail rather than
 * quietly become the second exception.
 */
const VIEWER_TIME: string[] = [];

/**
 * Every source file, minus its comments.
 *
 * Through `readSource` because the comments in this codebase QUOTE the thing
 * they are about — `locale.ts`'s own header contains the string "en-US" four
 * times explaining why it must not appear elsewhere. A raw read would report
 * the explanation as the offence.
 */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "__tests__") walk(p);
      } else if (/\.tsx?$/.test(p)) {
        out.push(p.replace(/\\/g, "/"));
      }
    }
  };
  walk("src");
  return out;
}

const files = sourceFiles().filter((f) => !OWNERS.includes(f) && !NOT_A_FORMAT.includes(f));

describe("formatting a date or an amount asks the club, not a hardcoded locale", () => {
  it("has files to sweep, and the owners are excluded — the sweep's own control", () => {
    expect(files.length, "no source files found — the sweep is broken").toBeGreaterThan(100);
    for (const owner of OWNERS) {
      expect(files, `${owner} should be excluded, not swept`).not.toContain(owner);
      // And it must still EXIST, or the exclusion is hiding a deleted module.
      expect(() => readSource(owner), `${owner} is missing`).not.toThrow();
    }
  });

  it("recognises a hardcoded locale when it sees one — the matcher's control", () => {
    /**
     * The instrument, checked against a line in exactly the shape the defect
     * took. Without this, a sweep reporting zero says nothing: it is equally
     * the answer you get from a pattern that has stopped matching.
     */
    const sample = `const s = d.toLocaleDateString("en-US", { month: "short" });`;
    expect(/["'`]en-US["'`]/.test(sample)).toBe(true);
  });

  it.each(files)("%s names no locale of its own", (file) => {
    const src = readSource(file);
    const hits = [...src.matchAll(/["'`](en-US|en-GB|ja-JP|de-DE|fr-FR)["'`]/g)].map((m) => m[1]);
    expect(
      hits,
      `this file hardcodes a locale. Dates and amounts are written the way the ` +
        `club writes them — resolve one with formattingFor() and pass it in, or ` +
        `take a locale argument defaulting to DEFAULT_LOCALE.`,
    ).toEqual([]);
  });

  /**
   * AND NOBODY FORMATS WITH THE VIEWER'S LOCALE EITHER.
   *
   * The quieter half, and arguably the worse one. `toLocaleDateString()` with
   * no argument uses whatever the reader's browser is set to, so the same
   * tournament read one way to the secretary on a UK laptop and another to a
   * member on a US phone — and neither of those is the club's answer.
   *
   * It is also invisible in development, because your machine is the locale
   * you would have hardcoded anyway.
   */
  it.each(files)("%s does not format with the reader's own locale", (file) => {
    if (VIEWER_TIME.includes(file)) return;
    const src = readSource(file);
    const bare = [
      ...src.matchAll(/toLocale(?:Date|Time)String\(\s*(undefined\s*[,)]|\))/g),
    ].map((m) => m[0]);
    expect(
      bare,
      `this formats with the VIEWER's locale. A club's tournament must not ` +
        `change shape depending on whose laptop is open — pass the club's.`,
    ).toEqual([]);
  });

  it("has no viewer-locale formatting left anywhere", () => {
    /**
     * NOT A COUNT, A LIST — so the failure names the file.
     *
     * The two that used to be here formatted an ACTION'S TIMESTAMP: when a
     * message was sent, when a card was signed. A timestamp reads like the
     * reader's own frame, which is why they were written that way and why they
     * did not look like the US-centric defect the rest of this sweep closes.
     * They still meant a club's own screens changed shape depending on whose
     * phone was open, so they are gone.
     *
     * What stops this becoming debt again is that the list is compared rather
     * than counted: a NEW file formatting with the viewer's locale fails here
     * by name, instead of quietly becoming the first exception — which is
     * exactly how the eleven hardcoded "en-US" calls accumulated.
     */
    const offenders = files.filter((f) =>
      /toLocale(?:Date|Time)String\(\s*(undefined\s*[,)]|\))/.test(readSource(f)),
    );
    expect(
      offenders.sort(),
      "a new viewer-locale format appeared — resolve the club's instead",
    ).toEqual([...VIEWER_TIME].sort());
  });
});

/**
 * ONE TOURNAMENT, ONE CURRENCY, END TO END.
 *
 * Everything a tournament takes or pays out — buy-ins, pots, prizes, expenses,
 * the settle-up — is in the one currency the organizer set. Nothing is
 * converted and no screen inside a tournament shows an amount in a different
 * money from the screen beside it.
 *
 * The way that breaks is not a conversion appearing; it is a SECOND SOURCE.
 * `currencyForEvent` used to read the club's currency directly and ignore the
 * tournament's override, so a tournament set to yen showed its pots in the
 * club's dollars on any screen that happened to call it — two currencies
 * inside one tournament, with no arithmetic anywhere and nothing looking
 * wrong.
 *
 * So the rule is positional again: asking the database for an organization's
 * currency is how a second answer gets in, and only the resolver may do it.
 */
describe("a tournament's money is all in one currency", () => {
  /**
   * The club's own bill, which is genuinely the club's and not the
   * tournament's.
   *
   * `previewSmsBroadcast` quotes what texting the field will cost the CLUB,
   * against the rate its SMS provider charges it. That is a club operating
   * cost, so it is priced in the club's currency even when the tournament on
   * screen is set to something else — and making it follow the tournament
   * would be the app claiming the club is billed in a currency it is not.
   *
   * Listed rather than excluded so the exception stays one, and stays
   * explained.
   */
  const CLUB_OWN_BILL = ["src/app/actions/messaging.ts"];

  /** Only the resolver may ask an organization what currency it is in. */
  const RESOLVER = ["src/lib/services/organization.ts"];

  it("reads an organization's currency in one place, plus the club's own bill", () => {
    const asking = files.filter((f) => {
      const src = readSource(f);
      // The shape of the query, not the word: `select: { … currency: true … }`
      // inside an organization lookup is what pulls a second answer out.
      return /organization[\s\S]{0,120}?currency:\s*true/.test(src) || /prisma\.organization[\s\S]{0,200}?currency:\s*true/.test(src);
    });
    expect(
      asking.sort(),
      `a second source for a tournament's currency. Ask formattingForEvent() ` +
        `so the tournament's own override is honoured — otherwise one screen ` +
        `shows the club's money and the next shows the tournament's.`,
    ).toEqual([...RESOLVER, ...CLUB_OWN_BILL].sort());
  });

  it("finds the resolver it is protecting — the sweep's own control", () => {
    // If `organization.ts` stopped querying a currency at all, the assertion
    // above would go green for the wrong reason.
    const src = readSource("src/lib/services/organization.ts");
    expect(src, "the resolver no longer reads a currency").toMatch(/currency:\s*true/);
    expect(src, "the resolver no longer honours the tournament's override").toContain(
      "currencyOverride",
    );
  });
});
