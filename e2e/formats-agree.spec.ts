import { test, expect } from "./coverage";
import { build } from "esbuild";
import * as locale from "../src/lib/domain/locale";
import * as moneyFormat from "../src/lib/domain/money-format";
import * as roundDates from "../src/lib/domain/round-dates";

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
 * What it does NOT cover: Safari and Firefox, whose locale data is different
 * again. The suite drives Chromium only.
 */

/**
 * Everything the app's formatters write, by name. Self-contained on purpose:
 * it is run here and, as source, inside the page.
 */
function everyFormat(api: { locale: typeof locale; money: typeof moneyFormat; rounds: typeof roundDates }): Record<string, string> {
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
      out[`month ${tag} ${d}`] = api.locale.formatMonth(d, tag);
      out[`short ${tag} ${d}`] = api.rounds.shortDate(d as never, tag);
    }
    for (const [a, b] of ranges) out[`range ${tag} ${a}..${b}`] = api.locale.formatDayRange(a, b, tag);
    out[`in words ${tag}`] = api.rounds.dayInWords("2026-05-14" as never, "2026-05-01" as never, tag);
    // And the three components that call the formatter themselves rather than
    // through the functions above — the same options, spelled as they spell
    // them: Recent changes, a message's date, and a time of day.
    const moment = new Date("2026-05-14T13:05:00Z");
    out[`recent changes ${tag}`] = moment.toLocaleString(tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
    out[`message date ${tag}`] = new Intl.DateTimeFormat(tag, { month: "short", day: "numeric", timeZone: "UTC" }).format(moment);
    out[`time of day ${tag}`] = moment.toLocaleTimeString(tag, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
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
  const here = everyFormat({ locale, money: moneyFormat, rounds: roundDates });

  // The same source, bundled for the page.
  const bundle = await build({
    stdin: {
      contents:
        'export * as locale from "./src/lib/domain/locale"; export * as money from "./src/lib/domain/money-format"; export * as rounds from "./src/lib/domain/round-dates";',
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
  expect(Object.keys(here).length).toBeGreaterThan(600);
  expect(Object.keys(there).sort()).toEqual(Object.keys(here).sort());
  expect(here["day en-GB 2026-05-14"]).toBe("14 May 2026");
  expect(here["money en-US USD"]).toBe("$1,234.56");

  const differ = Object.keys(here)
    .filter((k) => here[k] !== there[k])
    .map((k) => `${k}: server ${spelled(here[k])} · browser ${spelled(there[k])}`);
  console.log(`[formats-agree] ${Object.keys(here).length} formats in ${locale.LOCALES.length} locales and ${moneyFormat.CURRENCIES.length} currencies; ${differ.length} differ`);
  expect(differ, `${differ.length} formats the server and the browser write differently`).toEqual([]);
});
