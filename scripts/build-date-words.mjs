#!/usr/bin/env node
/**
 * THE WORDS AND THE ORDER EACH CLUB WRITES A DATE IN, READ ONCE AND KEPT.
 *
 *     node scripts/build-date-words.mjs            # write src/lib/domain/date-words.data.ts
 *     node scripts/build-date-words.mjs --check    # say what would change, write nothing
 *     node scripts/build-date-words.mjs --print    # print the table as JSON
 *
 * The app used to ask the platform to word every date as it drew it. A screen
 * is drawn twice — by the server, then by the browser — and each has its own
 * edition of the world's date conventions. Where the two editions part, React
 * throws the server's page away (#418). Four patches in three weeks chased
 * one difference each: a thin space, a tilde, a dash, a Korean "PM". The first
 * run on Firefox and on Safari's engine, 2026-10-13, found three more at once:
 * a comma after a British weekday, a padded hour, a Japanese range.
 *
 * So the app stops asking. This reads the conventions ONCE, from the Node this
 * script is run with, and writes them down as a table: the month and weekday
 * names, and for each shape of date the app writes, a template.
 * `src/lib/domain/date-words.ts` formats from the table with no locale data of
 * its own, so the server and every browser write the same bytes because they
 * run the same lines.
 *
 * IT PROVES ITS OWN TABLE BEFORE WRITING. Every template is used to format a
 * year of days, a day of hours in every month, and ranges of every kind, and
 * each line is compared with what the platform wrote. A template that cannot
 * reproduce the platform is a bug here, and nothing is written.
 *
 * ONE PLACE THE APP DOES NOT TAKE THE PLATFORM'S WORD: a range of days in
 * Japanese and Chinese. The platform this was first read from writes one day
 * with the characters for year, month and day after each figure, and a range of
 * them as "2026/05/14" to "2026/05/16" in bare figures and slashes: a different
 * notation for the same thing, because its data has no range for a short month
 * in those languages and it falls back. Firefox, whose data is newer, writes
 * the range in the words of the day. So does this (RANGE_AS_DAY).
 *
 * TO ADD A LANGUAGE: add its tag to TAGS, run this, READ the new line by eye —
 * it is what a club will see — then offer the tag in the picker (LOCALES in
 * locale.ts). A tag a club holds that is not in the table is still written by
 * the platform, as before, and can still differ between engines.
 *
 * No letter of another script is typed in this file or in the one it writes:
 * each is a code point here and an escape there, so no editor, shell or
 * checkout can re-encode one.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const TAGS = [
  // The picker's ten (LOCALES in locale.ts).
  "en-US", "en-GB", "en-AU", "en-IN", "ja-JP", "ko-KR", "zh-CN", "de-DE", "fr-FR", "es-ES",
  // And the English-speaking golf countries a club can be set to by hand, or seeded as.
  "en-IE", "en-ZA", "en-NZ", "en-CA",
];

/** Languages whose range of days is written in the words of one day, with this mark between the ends. */
const WAVE = String.fromCharCode(0xff5e);
const DASH = String.fromCharCode(0x2013);
// Set tight, both: the app closes a dash that stands between two days in every language (`evenRangeMark`),
// and a Chinese line is not spaced round its marks.
const RANGE_AS_DAY = { "ja-JP": WAVE, "zh-CN": DASH };

const OUT = "src/lib/domain/date-words.data.ts";
const UTC = "UTC";

/** The three kinds of space two editions disagree about, made one. The app's `plainSpaces`. */
const ODD_SPACES = new RegExp(`[${String.fromCharCode(0x202f, 0x2009, 0x00a0)}]`, "g");
const plain = (s) => s.replace(ODD_SPACES, " ");
/** A range mark set the one way: a tilde spaced, a dash between two digits closed up. The app's `evenRangeMark`. */
const DIGIT_DASH_DIGIT = new RegExp(`(\\d) *${DASH} *(\\d)`, "g");
const evenMark = (s) => s.replace(/ *~ */g, " ~ ").replace(DIGIT_DASH_DIGIT, `$1${DASH}$2`);
/** The same, for a template: a dash between two FIELDS that are written in digits. */
const FIGURES = "\\{(?:d|dd|n|nn|y)[12]?\\}";
const FIELD_DASH_FIELD = new RegExp(`(${FIGURES}) *${DASH} *(${FIGURES})`, "g");
const evenTemplateMark = (s) => s.replace(/ *~ */g, " ~ ").replace(FIELD_DASH_FIELD, `$1${DASH}$2`);

const utc = (y, m, d, h = 12, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min));
const two = (n) => String(n).padStart(2, "0");

/**
 * One part of a formatted date as a field. `suffix` is "1" or "2" inside a
 * range. The samples are chosen so a padded field and a bare one look
 * different: the 5th of a one-figure month, at five past nine.
 */
function token(part, at, suffix, names) {
  const v = part.value;
  const figures = /^\d+$/.test(v);
  switch (part.type) {
    case "literal":
      return plain(v).replace(/[{}]/g, "");
    case "year":
      return `{y${suffix}}`;
    case "month":
      if (figures) return v.length === 2 && at.getUTCMonth() + 1 < 10 ? `{nn${suffix}}` : `{n${suffix}}`;
      if (v === names.long[at.getUTCMonth()]) return `{B${suffix}}`;
      return `{b${suffix}}`;
    case "day":
      return v.length === 2 && at.getUTCDate() < 10 ? `{dd${suffix}}` : `{d${suffix}}`;
    case "weekday":
      return v === names.daysLong[at.getUTCDay()] ? `{A${suffix}}` : `{a${suffix}}`;
    case "hour": {
      const h24 = at.getUTCHours();
      const padded = v.length === 2 && (names.hour12 ? (h24 % 12 || 12) < 10 : h24 < 10);
      return names.hour12 ? (padded ? "{hh}" : "{h}") : padded ? "{HH}" : "{H}";
    }
    case "minute":
      return "{mm}";
    case "dayPeriod":
      return "{p}";
    default:
      throw new Error(`a part of a date this script does not know: ${part.type} "${v}"`);
  }
}

function namesFor(tag) {
  const monthIn = (m, opts) => new Intl.DateTimeFormat(tag, { ...opts, timeZone: UTC }).formatToParts(utc(2026, m, 14)).find((p) => p.type === "month").value;
  const short = Array.from({ length: 12 }, (_, i) => monthIn(i + 1, { month: "short", day: "numeric", year: "numeric" }));
  const long = Array.from({ length: 12 }, (_, i) => monthIn(i + 1, { month: "long", day: "numeric" }));
  // 2026-06-07 is a Sunday.
  const weekdayIn = (i, weekday) => new Intl.DateTimeFormat(tag, { weekday, day: "numeric", month: "short", timeZone: UTC }).formatToParts(utc(2026, 6, 7 + i)).find((p) => p.type === "weekday").value;
  const days = Array.from({ length: 7 }, (_, i) => weekdayIn(i, "short"));
  const daysLong = Array.from({ length: 7 }, (_, i) => weekdayIn(i, "long"));
  const clock = new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit", timeZone: UTC });
  const hour12 = clock.formatToParts(utc(2026, 3, 5, 13, 5)).some((p) => p.type === "dayPeriod");
  const period = (h) => clock.formatToParts(utc(2026, 3, 5, h, 5)).find((p) => p.type === "dayPeriod")?.value ?? "";
  return { short, long, days, daysLong, hour12, am: plain(period(1)), pm: plain(period(13)) };
}

/**
 * A month to read a template from: one figure (so a padded month shows), and —
 * with the month after it — a short name that is not also its long name.
 * German's March and May are both; a template read in March would call for
 * the long name all year, and the proof below is what caught it.
 */
function sampleMonth(names) {
  for (let m = 1; m <= 8; m++) if (names.short[m - 1] !== names.long[m - 1] && names.short[m] !== names.long[m]) return m;
  return 3;
}

function template(tag, opts, names) {
  const at = utc(2026, sampleMonth(names), 5, 9, 5);
  return new Intl.DateTimeFormat(tag, { ...opts, timeZone: UTC }).formatToParts(at).map((p) => token(p, at, "", names)).join("");
}

function rangeTemplate(tag, opts, names, a, b) {
  const parts = new Intl.DateTimeFormat(tag, { ...opts, timeZone: UTC }).formatRangeToParts(a, b);
  // A part both ends share (the month of "14-16 May", the year) is written once, and is the start's.
  return evenTemplateMark(
    parts
      .map((p) => {
        const end = p.source === "endRange";
        return token(p, end ? b : a, p.type === "literal" ? "" : end ? "2" : "1", names);
      })
      .join(""),
  );
}

/** A range in the words of one day: the day's own template, cut into its fields, with a mark between the ends. */
function rangeAsDay(dayTemplate, mark) {
  const pieces = dayTemplate.match(/\{[a-zA-Z]+\}[^{]*/g) ?? [];
  const numbered = (n) => pieces.map((p) => p.replace("}", `${n}}`));
  const start = numbered(1);
  const end = numbered(2);
  const from = (key) => end.slice(end.findIndex((p) => p.startsWith(`{${key}`)));
  if (pieces.length !== 3 || !dayTemplate.startsWith("{y}")) throw new Error(`a day written "${dayTemplate}" is not year-first: write its range by hand`);
  return {
    rangeInMonth: start.join("") + mark + from("d").join(""),
    rangeInYear: start.join("") + mark + from("n").join(""),
    rangeAcross: start.join("") + mark + end.join(""),
  };
}

const DAY = { month: "short", day: "numeric", year: "numeric" };
const SHAPES = {
  day: DAY,
  monthDay: { month: "short", day: "numeric" },
  weekdayDay: { weekday: "short", day: "numeric", month: "short" },
  stamp: { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
  time: { hour: "numeric", minute: "2-digit" },
  wall: { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" },
};

function build(tag) {
  const names = namesFor(tag);
  const t = {};
  for (const [name, opts] of Object.entries(SHAPES)) t[name] = template(tag, opts, names);
  const m = sampleMonth(names);
  t.rangeInMonth = rangeTemplate(tag, DAY, names, utc(2026, m, 5), utc(2026, m, 7));
  t.rangeInYear = rangeTemplate(tag, DAY, names, utc(2026, m, 5), utc(2026, m + 1, 7));
  t.rangeAcross = rangeTemplate(tag, DAY, names, utc(2026, m, 5), utc(2027, m + 1, 7));
  if (RANGE_AS_DAY[tag]) Object.assign(t, rangeAsDay(t.day, RANGE_AS_DAY[tag]));
  return { months: names.short, monthsLong: names.long, days: names.days, daysLong: names.daysLong, am: names.am, pm: names.pm, hour12: names.hour12, ...t };
}

/** The formatter the app uses (`writeDate` in date-words.ts), spelled again so the table is proved before it is written. */
function fill(w, tpl, a, b) {
  const field = (d, key) => {
    const h = d.getUTCHours();
    switch (key) {
      case "y": return String(d.getUTCFullYear());
      case "n": return String(d.getUTCMonth() + 1);
      case "nn": return two(d.getUTCMonth() + 1);
      case "b": return w.months[d.getUTCMonth()];
      case "B": return w.monthsLong[d.getUTCMonth()];
      case "d": return String(d.getUTCDate());
      case "dd": return two(d.getUTCDate());
      case "a": return w.days[d.getUTCDay()];
      case "A": return w.daysLong[d.getUTCDay()];
      case "h": return String(h % 12 || 12);
      case "hh": return two(h % 12 || 12);
      case "H": return String(h);
      case "HH": return two(h);
      case "mm": return two(d.getUTCMinutes());
      case "p": return h < 12 ? w.am : w.pm;
      default: throw new Error(`no such field: ${key}`);
    }
  };
  return tpl.replace(/\{([a-zA-Z]+)([12]?)\}/g, (_, key, end) => field(end === "2" ? b : a, key));
}

function prove(tag, w) {
  const wrong = [];
  const check = (what, mine, theirs) => {
    if (mine !== theirs) wrong.push(`${tag} ${what}: the table writes "${mine}", the platform "${theirs}"`);
  };
  const fmt = (opts) => new Intl.DateTimeFormat(tag, { ...opts, timeZone: UTC });
  const iso = (d) => d.toISOString().slice(0, 10);
  // Every day of a year, in the three shapes that are a day.
  for (let i = 0; i < 365; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i, 12));
    for (const shape of ["day", "monthDay", "weekdayDay"]) check(`${shape} ${iso(d)}`, fill(w, w[shape], d), plain(fmt(SHAPES[shape]).format(d)));
  }
  // Every hour of a day, in every month (a month's name is in two of these).
  for (let m = 1; m <= 12; m++) {
    for (let h = 0; h < 24; h++) {
      const d = utc(2026, m, 3 + h, h, 5);
      for (const shape of ["stamp", "time", "wall"]) check(`${shape} ${d.toISOString()}`, fill(w, w[shape], d), plain(fmt(SHAPES[shape]).format(d)));
    }
  }
  // Ranges of each kind, from every month — except where the app sets its own.
  if (!RANGE_AS_DAY[tag]) {
    for (let m = 1; m <= 12; m++) {
      const pairs = [
        ["rangeInMonth", utc(2026, m, 3), utc(2026, m, 4)],
        ["rangeInMonth", utc(2026, m, 9), utc(2026, m, 21)],
        ["rangeAcross", utc(2026, m, 27), utc(2027, m, 2)],
      ];
      if (m < 12) pairs.push(["rangeInYear", utc(2026, m, 28), utc(2026, m + 1, 2)]);
      for (const [kind, a, b] of pairs) check(`${kind} ${iso(a)}..${iso(b)}`, fill(w, w[kind], a, b), evenMark(plain(fmt(DAY).formatRange(a, b))));
    }
  }
  return wrong;
}

const table = {};
const wrong = [];
for (const tag of TAGS) {
  table[tag] = build(tag);
  wrong.push(...prove(tag, table[tag]));
}

if (process.argv.includes("--print")) {
  console.log(JSON.stringify(table, null, 1));
  process.exit(0);
}

if (wrong.length) {
  console.error(`${wrong.length} line(s) the table cannot write as the platform does — nothing written:`);
  for (const w of wrong.slice(0, 40)) console.error(`  ${w}`);
  process.exit(1);
}

// Anything that is not plain ASCII is written as an escape.
const ascii = (s) => s.replace(/[^\x20-\x7E]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
const lines = [
  "// WRITTEN BY scripts/build-date-words.mjs. Do not edit by hand: run the script and read what changed.",
  `// Read from Node ${process.versions.node} (ICU ${process.versions.icu}, CLDR ${process.versions.cldr}).`,
  "// Anything that is not plain ASCII is an escape on purpose: nothing can re-encode it.",
  'import type { DateWords } from "./date-words";',
  "",
  "export const DATE_WORDS: Record<string, DateWords> = {",
  ...TAGS.map((tag) => `  ${JSON.stringify(tag)}: ${ascii(JSON.stringify(table[tag]))},`),
  "};",
  "",
];
const next = lines.join("\n");
const body = (s) => s.replace(/\r\n/g, "\n").split("\n").filter((l) => !l.startsWith("//")).join("\n");

if (process.argv.includes("--check")) {
  const now = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (body(now) === body(next)) {
    console.log(`date words: ${TAGS.length} languages; this Node (CLDR ${process.versions.cldr}) would write the table as it stands`);
    process.exit(0);
  }
  const a = body(now).split("\n");
  const b = body(next).split("\n");
  console.log(`date words: this Node (CLDR ${process.versions.cldr}) would write the table differently:`);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) console.log(`  - ${(a[i] ?? "").slice(0, 400)}\n  + ${(b[i] ?? "").slice(0, 400)}`);
  process.exit(1);
}

writeFileSync(OUT, next);
console.log(`date words: ${TAGS.length} languages written to ${OUT}, each proved against a year of days, a day of hours in every month, and ranges of every kind`);
