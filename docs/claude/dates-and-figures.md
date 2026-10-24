# Dates and figures

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: writing a date/time/amount, or reading money a person typed. Index: `CLAUDE.md`.

**And one cause found by CI and by nothing local, 2026-10-12: the server's Node is not the
browser.** CI runs Node 20; this machine runs Node 24, whose locale data agrees with Chromium's.
A Korean clock time was "PM 1:05" from the server and "오후 1:05" in the browser — on CI only.
`formatClock` in `domain/locale.ts` takes the day-period word from its own table, and
`a-clock-time-is-written-once.test.ts` refuses a bare `toLocaleTimeString` in `src`.
`npx -y node@20 file.cjs` runs anything under CI's Node from here.

**AND THE CLASS IS CLOSED, NOT THE INSTANCE: SINCE 2026-10-13 THE APP WRITES ITS OWN DATES.**
A thin space, a Korean tilde, a British dash and a Korean "PM" were each patched where they
showed. The first run of the suite on Firefox and on Safari's engine then found three more in
one evening — a comma after a British weekday (which redrew the Rounds screen on every load, on
every iPhone), an hour written "1:05" by the server and "01:05" by Firefox, a Japanese range in
another notation. Every one is the same fault: two platforms, two editions of the conventions.

So the conventions are read ONCE, by `scripts/build-date-words.mjs` (which proves its table
against a year of days before writing it), into `src/lib/domain/date-words.data.ts`, and
`date-words.ts` fills a template in. It asks the platform for arithmetic only. Every date the
app writes goes through it — `formatDay`, `formatDayAt`, `formatMonthDayAt`, `formatDayRange`,
`formatClock`, `shortDate`, `clubClockInWords` — and three tests hold that:

- `date-words.test.ts` pins what each country's club reads, typed by hand; refuses a language
  the picker offers and the table does not hold; and refuses any screen that words a date by
  asking the platform (`new Intl.DateTimeFormat(locale…`, `toLocaleDateString`);
- `date-words-are-read.test.ts` swaps the table for one no platform would write, so a caller
  put back to asking the platform FAILS. On the machine the table was read from the platform
  writes the same thing, and a test of values alone cannot tell the two apart;
- `e2e/formats-agree.spec.ts` runs the same functions on both sides, on every engine a round
  drives.

A tag the table does not hold is still the platform's, and can still differ. AMOUNTS are still
the platform's too, and are measured by the same spec: no engine has disagreed about one yet.
To add a language, see `docs/testing.md`.

**AND WHAT THE APP WRITES IN A CLUB'S LANGUAGE, IT MUST READ BACK IN THAT LANGUAGE.** The
formatter was given the club's locale and the reader was not. A German, French or Spanish club's
stake, written "5,00" in its own box by this app, was read back as 500.00, and "1.234,56" as 1.23
— on the skins pot, every side bet, every shared cost and the kitty. Found 2026-10-13 by the
first browser test to start a side bet; measured before the fix, 90 of 392 locale × currency ×
amount combinations read back wrong. `one-currency.test.ts` had held "the parser is the exact
inverse of the formatter, in every currency offered" for months and formatted in en-US every
time: the rule ranged over two axes and the test walked one.

- `minorUnitsFrom(text, currency, locale)` reads which mark is the decimal one off the TEXT (both
  marks: the last; one mark more than once: grouping; one mark once: three digits after it group,
  anything else is the decimal), so the server and every browser read one figure one way. It
  still gives 0 for junk, never NaN — so a caller that must REFUSE a box with no figure in it
  checks for a digit itself (`ContestsClient`), because `Number.isFinite` will never say no.
- `decimalPoint()` in `domain/decimal-text.ts` is the same class for figures that are not money:
  a handicap "12,4" was refused by the entry form and read as SCRATCH by a casual round, and a
  course rating "71,3" was stored as 71.0. Any new reader of a decimal somebody types goes
  through one of the two.
- `figures-are-read-in-every-language.test.ts` walks every language and currency a club can
  choose, from the app's own lists; `e2e/side-bet-named-winner.spec.ts` does it as a German club.
