import { test, expect } from "./coverage";
import { build } from "esbuild";
import * as locale from "../src/lib/domain/locale";
import * as moneyFormat from "../src/lib/domain/money-format";
import * as roundDates from "../src/lib/domain/round-dates";
import * as clubClock from "../src/lib/domain/club-clock";

/**
 * THE SERVER AND THE BROWSER WRITE A DATE AND AN AMOUNT IN THE SAME BYTES —
 * for every locale and currency the app offers (2026-10-11).
 *
 * A client component is rendered on the server, by Node, and again in the
 * browser. When it formats a date or an amount while rendering, each side uses
 * its OWN locale data — and the two ship different versions of it. Where they
 * disagree, even by a space, React throws the server's HTML away and reports
 * #418: the fault that struck six screens of this app, never the same one
 * twice and never on demand.
 *
 * "Never on demand" because it only happens under a locale where the two
 * disagree. It had been met once — a thin space round a range dash, flattened
 * by `plainSpaces` on 2026-09-25 — and the test written then asks about that
 * one kind of space, in six locales, IN NODE. It cannot see a difference Node
 * does not have. On 2026-10-11 the control crawl set a tournament to Korea and
 * the page mismatched on every load: Node writes a Korean range "14일~16일",
 * Chromium "14일 ~ 16일".
 *
 * So this does not ask whether a known difference is gone. It RUNS the app's
 * own formatters twice — here, and in the browser, from the same source — over
 * every locale and currency the pickers offer, and holds the two results to be
 * the same bytes. A disagreement the app has not met yet fails here, on the
 * day a Node or a Chromium upgrade introduces it, instead of on a screen.
 *
 * SINCE 2026-10-13 THE DATES ARE THE APP'S OWN. The first run of this spec on
 * Firefox and on Safari's engine found twelve and thirteen differences, every
 * one a date or a time: a comma after a British weekday, a padded hour, a
 * Japanese range. So `domain/date-words.ts` now writes every date from a table
 * in the repository and asks neither side's platform for a word — and for a
 * date this spec has become the proof of THAT: both sides agree because both
 * run the same lines. Amounts are still the platform's, and still measured
 * here, and so is any tag the table does not hold.
 *
 * Which engines: Chromium in every push, and Firefox and Safari's engine in
 * the layers of a round that drive them (`scripts/qa/layers.mjs`). A phone two
 * years old carries a fourth edition that nothing here runs; for a date that
 * no longer matters, and for an amount it still could.
 */

/**
 * Everything the app's formatters write, by name. Self-contained on purpose:
 * it is run here and, as source, inside the page.
 */
function everyFormat(api: { locale: typeof locale; money: typeof moneyFormat; rounds: typeof roundDates; clock: typeof clubClock }): Record<string, string> {
  const out: Record<string, string> = {};
  const tags = api.locale.LOCALES.map((l) => l.tag);
  const codes = api.money.CURRENCIES.map((c) => c.code as string);
  // A day in every month (the abbreviations are where locale data moves), and
  // ranges inside a month, across one, and across a year.
  const days = Array.from({ length: 12 }, (_, m) => `2026-${String(m + 1).padStart(2, "0")}-14`);
  const ranges = [
    ["2026-05-14", "2026-05-16"],
    ["2026-05-30", "2026-06-02"],
    ["2026-12-30", "2027-01-02"],
    ["2026-09-01", "2026-09-30"],
  ];
  for (const tag of tags) {
    for (const d of days) {
      out[`day ${tag} ${d}`] = api.locale.formatDay(d, tag);
      // `formatMonth` is only ever called with the default locale — it is the
      // month in a fallback when `Intl` refuses a tag (`shortDate`). Asked of
      // every locale it reported Australia's "Jun" against WebKit's "June",
      // which no screen can draw: a month name on its own is locale DATA, and
      // differs by engine and by year. A real caller for another locale would
      // have to be added here, and would then be measured.
      if (tag === api.locale.DEFAULT_LOCALE) out[`month ${tag} ${d}`] = api.locale.formatMonth(d, tag);
      out[`short ${tag} ${d}`] = api.rounds.shortDate(d as never, tag);
    }
    for (const [a, b] of ranges) out[`range ${tag} ${a}..${b}`] = api.locale.formatDayRange(a, b, tag);
    out[`in words ${tag}`] = api.rounds.dayInWords("2026-05-14" as never, "2026-05-01" as never, tag);
    // And the three components that call the formatter themselves rather than
    // through the functions above — the same options, spelled as they spell
    // them: Recent changes, a message's date, and a time of day.
    const moment = new Date("2026-05-14T13:05:00Z");
    // Both clock times through `formatClock`, as the components now write them. They used to be spelled
    // here as the components spelled them — `toLocaleString` — and the first CI run found the server and
    // the browser writing a Korean "PM" differently; see `formatClock`. Before noon as well as after,
    // so both words of every language are compared.
    out[`recent changes ${tag}`] = api.locale.formatClock(moment, tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
    out[`recent changes before noon ${tag}`] = api.locale.formatClock(new Date("2026-05-14T01:05:00Z"), tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
    out[`message date ${tag}`] = api.locale.formatMonthDayAt(moment, tag, "UTC");
    out[`score stamp ${tag}`] = api.locale.formatDayAt(moment, tag, "UTC");
    // The club's wall clock, in a zone that is not the server's: the figures are the zone's, the words the club's.
    out[`wall clock ${tag}`] = api.clock.clubClockInWords("Asia/Tokyo", tag, moment);
    out[`24-hour clock ${tag}`] = String(api.locale.usesTwentyFourHourClock(tag));
    out[`time of day ${tag}`] = api.locale.formatClock(moment, tag, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
    out[`time of day before noon ${tag}`] = api.locale.formatClock(new Date("2026-05-14T01:05:00Z"), tag, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
    for (const code of codes) {
      out[`money ${tag} ${code}`] = api.money.money(123456, code, tag);
      out[`money ${tag} ${code} negative`] = api.money.money(-50, code, tag);
      out[`whole ${tag} ${code}`] = api.money.wholeMoney(1750, code, tag);
    }
  }
  for (const code of codes) out[`symbol ${code}`] = api.money.currencySymbol(code);
  return out;
}

/** A string with anything that is not plain printable ASCII spelled as its code point, so a difference can be read. */
const spelled = (s: string) =>
  Array.from(s)
    .map((ch) => {
      const cp = ch.codePointAt(0)!;
      return cp >= 32 && cp < 127 ? ch : `<U+${cp.toString(16).toUpperCase()}>`;
    })
    .join("");

test("the server and the browser format every date and amount the app offers in the same bytes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one browser engine: the three projects share it");
  const here = everyFormat({ locale, money: moneyFormat, rounds: roundDates, clock: clubClock });

  // The same source, bundled for the page.
  const bundle = await build({
    stdin: {
      contents:
        'export * as locale from "./src/lib/domain/locale"; export * as money from "./src/lib/domain/money-format"; export * as rounds from "./src/lib/domain/round-dates"; export * as clock from "./src/lib/domain/club-clock";',
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    globalName: "__thqFormats",
    write: false,
    logLevel: "silent",
  });
  await page.goto("about:blank");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const there = (await page.evaluate(`(${everyFormat.toString()})(window.__thqFormats)`)) as Record<string, string>;

  // CONTROLS: both sides formatted the whole list, and it is the list the pickers offer.
  expect(Object.keys(here).length).toBeGreaterThan(550);
  expect(Object.keys(there).sort()).toEqual(Object.keys(here).sort());
  expect(here["day en-GB 2026-05-14"]).toBe("14 May 2026");
  expect(here["money en-US USD"]).toBe("$1,234.56");

  const differ = Object.keys(here)
    .filter((k) => here[k] !== there[k])
    .map((k) => `${k}: server ${spelled(here[k])} · browser ${spelled(there[k])}`);
  console.log(`[formats-agree] ${Object.keys(here).length} formats in ${locale.LOCALES.length} locales and ${moneyFormat.CURRENCIES.length} currencies; ${differ.length} differ`);
  expect(differ, `${differ.length} formats the server and the browser write differently`).toEqual([]);
});
