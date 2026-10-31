<!-- Copied from the panel ruling of 30 Oct 2026, without the pilot event's specifics. Supersedes print-kit-panel-2026-10-23.md. -->
# Print kit: the panel's ruling, 30 Oct 2026

**This replaces** `docs/print-kit-panel-2026-10-23.md`. That decision was re-judged against how things stand today, not deferred to. Ajay asked for "not the old decision but current".

**What it covers:** PR #938, branch `claude/print-kit`, up to date with main. It has 5 commits and 40 files on main. Read-only review; nothing was changed.

**Binding asks:**
- Ajay, 30 Oct: the doors are in Reports and the Tee sheet, "you know the best".
- "any card is the card size".
- "we can go with some exceptions": an exception only "where we cant meet the normal scorecard".
- Real data only.
- "side game", never "bet", and no money on paper.
- Country words.
- App first: this is built after G1.

---

## 1. What the branch does today

- `/print` has one renderer (`components/print/PrintPages.tsx`) and seven documents: Scorecards, Group cards, Match result slips, Cup match cards, Cart signs, Spare sign and Starting sheet.
- **Every document is a full A4 or Letter page.** A scorecard runs 18 holes across a landscape sheet with a 64 mm name column, names at 14 pt and the body at 10 pt or more. That is the "too long" card Ajay held: 11 in long, which no scorecard clip or pocket takes.
- It already does:
  - the per-sheet fingerprint, with "N printed sheets are out of date, reprint these" (`Stage.printLog`);
  - the club-clock stamp;
  - the never-on-paper sweep (`paperRefusals`, which refuses "bet", money, email and phone);
  - the paper-equals-screen audit, which found and fixed a plus-handicap fault in `domain/team.ts`;
  - the QR codes pointing to `/play#CODE`.
- **Doors today:** the "Print kit" nav item, plus links from:
  - Tee sheet: Print… and the out-of-date warning;
  - Team cup;
  - Round codes: "Print the signs";
  - Reports: Exports, "Named scorecards and group cards".
- **Faults outstanding:**
  - `country-words.test.ts` fails. The text a person can read says "cart" literally in `DOC_TITLE.signs`, the two `— cart sign` labels in `services/print-kit.ts`, and twice on `/print/page.tsx`. Any other occurrences are in `PrintKitClient.tsx` or `PlaySettings.tsx`; the test lists them all.
  - The migration `A019_a_round_remembers_what_was_printed` sorts before main's `A030`.

---

## 2. Each role's view

**Tournament Director.**
- A card that will not go in a back pocket or the cart's scorecard clip gets folded badly, gets wet, and comes back unreadable.
- Real club cards are a narrow strip: front nine, Out, back nine, In, Total, with the players as rows. Print that strip, two to a sheet, and a pair of scissors does the rest.
- One cart sign per cart, not per group. That was Ajay's original cart-tag ask: two riders, the starting hole, the code.

**Golf Professional.**
- Shrinking the card must not lose what the Rules need:
  - the player's name;
  - the handicap (course and playing);
  - par and stroke index per hole;
  - the stroke dots;
  - the marker's and the player's signature (Rule 3.3b);
  - for four-ball, one card per side with each partner's score on their own line (Rule 23.2b).
- Yards are a courtesy and can be condensed. The stroke index cannot.
- Stableford needs a points column for the Committee.
- Match play needs only a result slip.

**UI/UX Engineer (print).**
- One trim for every card: **9.5 × 3.75 in (241.3 × 95.25 mm)**. It sits two-up on both US Letter and A4 landscape with room for crop marks, so a club's card is the same everywhere.
  - 4.25 × 11 in is exactly half a Letter sheet: no room for cut marks, and an A4 printer cannot make it.
  - 4 × 9 in is too narrow for 18 holes plus Out, In, Total and Net at a box a pencil can use.
- Type has a floor of 7 pt. Names are 10 pt, stepping down to 8 pt; past that, use the initial plus the surname, and never cut a name off silently.
- Nothing may depend on the system's fonts, or the browser test measures a different card from the one the printer makes.

**Customer Success (the a pilot club organizer and the pilot clubs).**
- A new organizer prints at home on Letter, probably on an inkjet, the night before. They need:
  - a "Print N sheets" figure;
  - "print at Actual size / 100%";
  - a cut line they can see;
  - a 50 mm check line to measure.
- Every extra document on the list is a question I will be asked at 6 am. a pilot club needs four documents, not seven.
- The cheat sheet's step 8 ("Show the signs") must change to the Print kit.

**QA Lead.**
- "Fits" must be measured in the browser, at print size, in Chromium and in WebKit (Safari prints differently).
- The test fails on any element outside the card's safe box, any clipped text, any font under 7 pt, a QR under 30 mm, or a code under 40 pt.
- It needs a control that is shown to fail.
- Because `domain/team.ts` (handicap arithmetic) is in the diff, the branch keeps THREE rounds. Plan the calendar for that.

**Marketing Manager.**
- Every player in a pilot club holds this card, so it should look like the club's own: club logo or name first.
- Ours is one 7 pt grey line at the foot, "Scored live with TourneyHQ · tourneyhq.club/play", never the front door and never near the scoring area. That stays.
- The removable footer on Eagle and above was already ruled (24 Oct). It is a later slice, not now.

**Budget Keeper.**
- Two cards per sheet roughly halves the paper.
  - Today: 18 cards plus 18 signs is 36 sheets for an 18-team field.
  - Ruled: 9 sheets of cards plus 18 sheets of signs (one per cart, two-up).
- Black only, no tinted grounds, no bleed.
- Reprint only what changed (already built).
- Show the sheet count on the Print button before anyone presses it.
- Drop the duplicate starting-sheet copy and the separate Group cards document.

---

## 3. THE RULING

### 3.1 The doors

The doors are chosen for use, not for count. All of them open the one renderer.

| Door | Ruling | Why |
| --- | --- | --- |
| **Tee sheet**: "Print…" under the published sheet, plus the out-of-date warning | **IN, the primary door** (exists) | This is where the groups are made and changed, so this is where a reprint is needed. |
| **Reports**: a "Print kit" item in Exports (cards, {cart} signs, starting sheet), replacing today's "Named scorecards and group cards" row | **IN, slice 1** | Ajay asked for it. Later the results sheet joins it here. |
| **Nav "Print kit"** (On the day) | **IN** (exists) | The secretary's morning checklist. |
| Team cup "Print…" and Round codes "Print the signs" | **Kept** (exist) | These are the cup's tee sheet and the code's own screen. The same renderer, so there is no second answer on paper. |
| **Dashboard on the day** | **Slice 2, after G1 and G2 land** | Only as a "To sort out" line on the club's day before and day of: "N printed sheets are out of date" or "Not printed yet". Never the main button. G1 and G2 own those files now. |
| **Setup checklist** | **OUT** | Printing is not setup. A paper-free club should not be nagged, and the checklist is G2's. |

### 3.2 Documents in and out

**In, slice 1:**
- **Scorecards.** One card per player (individual stroke play or Stableford, Rule 3.3b), per side (four-ball, foursomes, greensomes, scramble), or per group by choice (an outing's group card).
  - The old separate "Group cards" document becomes the choice "One card per player / One per group" inside Scorecards, offered only for individual formats.
- **{Cart} signs:** one per {cart}.
- **Spare sign.**
- **Starting sheet.**
- **Match result slips.**
- **Cup match cards.**

**Dropped as overbuilt:**
- Group cards as a separate document (folded into Scorecards).
- The two-copy starting sheet (noticeboard plus starter). It becomes one sheet with an "On the tee" tick column; print as many as needed.
- Full-page cards of every kind.
- The rule "names 14 pt, body 10 pt" for cards. It still holds for the full-page starting sheet.

**Kept from the old decision:** one renderer; the stamp with its version; reprint only what changed; never-on-paper; black on white; club first; the footer line; QR to `/play#CODE`; the paper-equals-screen audit.

**Later (slice 3):** results sheet and prize list under Reports (gross and net, countback marked).

**Parked:**
- poster;
- one-pager;
- rules of the day;
- knockout draw sheet;
- pin sheet;
- "score card enhancements". Ajay's meaning of that is still unknown.

### 3.3 The normal scorecard: one trim for every card

**THE NORMAL CARD: 9.5 × 3.75 in = 241.3 × 95.25 mm, landscape, printed TWO-UP.**

There is no A-series card of this size. The nearest standard is DL (220 × 110 mm). One trim is used on both papers, so a club's card is the same in every country.

| Sheet | Card position (from the sheet's top-left, landscape) | Margins |
| --- | --- | --- |
| US Letter landscape (279.4 × 215.9) | x = 19.05; y = 9.5 and 111.1 | sides 19.05; top 9.5, gutter 6.35, bottom 9.5 |
| A4 landscape (297 × 210) | x = 27.85; y = 6.5 and 108.25 | sides 27.85; top 6.5, gutter 6.5, bottom 6.5 |

**Rules for every card:**
- **Safe area:** 4 mm inside the trim, so the content box is 233.3 × 87.25 mm. Nothing is drawn outside it.
- **Ink on the sheet:** never within 5 mm of the paper's edge. Home printers do not print there.
- **Crop marks:** 0.25 pt black, 5 mm long, 2 mm off the trim.
  - They go only where the margin is 7 mm or more: the side margins for the horizontal cuts.
  - The shared horizontal cut through the gutter is a 0.25 pt dashed line marked "cut".
- **Calibration line:** every sheet carries a 50 mm line in the side margin labelled "50 mm / 1.97 in: measure this if the cards come out the wrong size". The hub says "Print at Actual size (100%), headers and footers off".
- **One card per page-slot.** Nothing splits across sheets. Pages are ordered so the cut cards come out in group order.

**Type:**
- 7 pt is the floor for everything, including the stamp and our footer.
- Grid figures 9 pt.
- Names 10 pt, stepping down to 8 pt to fit one line, then two lines at 8 pt. Past that, `cardName()` gives "M. Featherstonehaugh-Worthington" (initial plus surname). The full name stays on the starting sheet.
- Club name 9 pt bold, down to 7 pt, at most 2 lines; or the logo at 9 mm high and at most 40 mm wide.
- Event 11 pt, down to 8 pt, at most 2 lines.
- One self-hosted face (`next/font/local`, a condensed OFL sans such as Roboto Condensed or Archivo Narrow, cleared with the brand guard), so the test measures what prints.

**Abbreviations:** Hole · Yds · Par · S.I. · CH (course handicap) · PH (playing handicap) · Out · In · Tot · Net · Pts.
- Starting hole: "Starts: Hole 7" or "Tee 1 · 8:10".

#### A. Scorecard, 18 holes (and 9)

**Columns, left to right:**
- Name: 40 mm.
- Holes 1–9, Out, 10–18, In, Tot, then Net (stroke play) or Pts (Stableford): 22 columns of 8.5 mm (187 mm).
- Total width 227 mm, inside the 233.3 mm safe width.
- On a back-nine start the columns follow the course's own numbering (`holeNumber`).
- **9 holes:** the name column, 9 holes, Tot and Net or Pts. Boxes widen to 14 mm. There is no "In" column, because an empty box gets filled in.

**Rows, top to bottom:**
1. Header strip, 13 mm:
   - left: the club logo or name;
   - centre: the event, with round · date · course · tees at 7.5 pt;
   - right: the starting hole or time, 16 pt, in a 1 pt box.
2. Hole, 5 mm.
3. Yds, 4 mm per tee in play. **At most 2 rows.** With 3 or more tees on one card, each player's tee and yardage total go beside the name instead.
4. Par, 5 mm.
5. S.I. (the club's stroke index), 4.5 mm.
6. **Player rows, 8.5 mm each, at most 4.**
   - The name cell: the name, then "CH 13 · PH 12 · White" at 7 pt.
   - Strokes as solid dots in the box's corner (two dots for two).
   - "To be confirmed", with no dots, when the handicap is unconfirmed.
7. Signatures, 8 mm: "Marker ______  Player ______". A group or side card reads "Scorer ______  Attested ______".
8. Foot, 3 mm, at 7 pt:
   - left: the stamp, "Printed 28 Nov 18:40 · v2";
   - right: "Scored live with TourneyHQ · tourneyhq.club/play".

**Budget:** 13 + 5 + 8 + 5 + 4.5 + 34 + 8 + 3 = **80.5 mm**, within 87.25.

**Which rows each format gets:**
- **Individual stroke play or Stableford, one per player:** one player row.
- **Group card:** 2–4 player rows.
- **Four-ball (Rule 23.2b), one card per SIDE:** partner A, partner B, and a "Side" row (best ball, for the Committee).
- **Foursomes, greensomes, scramble:** one card per side with one row. The side's name goes at 10 pt, with its players at 7.5 pt on up to 2 lines beneath.

#### B. {Cart} sign

The normal card again, one per {cart}, two-up. It fits the {cart}'s scorecard clip and a half-Letter or A5 sleeve.
- Riders: the group split in pairs, in tee-sheet order. A group of 3 gives a 2 and a 1.
- Choice: "One per {cart} / One per group (walking)".

**Layout:**
- **Left 140 mm:**
  - "{Cart} 7A" at 18 pt;
  - start or time at 18 pt, boxed;
  - every player in the group, with this {cart}'s riders in bold, 11 pt each. Under each name, 7.5 pt: "PH 12 · strokes 1–9: 3, 7 · 10–18: 12, 15" (`strokesByNine`);
  - the scorer's job, in one sentence at 8 pt, at most 2 lines.
- **Right 90 mm:**
  - a **40 mm QR** (quiet zone of 4 modules, error correction M);
  - the code in 40 pt monospace beneath it;
  - `tourneyhq.club/play#CODE` at 8 pt monospace.
- **Two codes** (a cup day with two sessions): two 32 mm QRs side by side, each with its own 40 pt code. **30 mm is the floor.**

#### C. Spare sign

The normal card, two-up by default: one for the first tee, one for the clubhouse.
- A 60 mm QR.
- The round name at 18 pt.
- "Scan to enter your score" at 14 pt.
- The code at 48 pt.
- "No camera? tourneyhq.club/play and type the code" at 9 pt.

#### D. Match result slip

The normal card, two-up. A match needs no scorecard.
- Header strip.
- The match label at 12 pt, then format · start · time.
- The two sides **side by side**, 110 mm each: the name at 11 pt, the players at 9 pt, the strokes at 8 pt.
- "Won by ______  Result (3&2, 1 up, halved) ______".
- One signature line per side.
- Foot.

#### E. Cup match card, one session's format on all 18 or one nine

The normal card. It has Ajay's 18 Oct content: club S.I., yards, dots off the low player, and the better-ball and match rows.
- **One format** (e.g. four-ball all 18): 4 player rows, 2 better-ball rows and 1 match row = 7 rows at 7 mm (49 mm).
  - Budget: 13 + 5 + 4 + 5 + 4.5 + 49 + 8 + 3 = 91.5. That is over 87.25.
  - So the match row merges into the Result column (the match's state is written there hole by hole). That gives 6 rows at 7 mm = 42 mm, a budget of 84.5 mm with one yards row, which fits. With 2 tees in play the second yards row goes; each player's tee goes beside their name.
  - **Singles** (2 players and 1 match row) fit with yards.

### 3.4 The exceptions, where the normal scorecard genuinely cannot be met

Only these. Each one is **a larger card that folds to the normal card**, never smaller type. Everything else is held strictly to the normal card.

| # | Case | Why it cannot meet the normal card | Alternative |
| --- | --- | --- | --- |
| X1 | **Cup match card on a mixed day**: four-balls on one nine and singles on the other, both "on the one card" as Ajay liked | 7 four-ball rows plus 6 singles rows plus par, S.I. and yards is 13 rows. At the 7 pt floor and a writable box (6 mm or more) it needs about 125 mm against 87 mm. | **Fold-out: 241.3 × 190.5 mm flat, folding once to the normal card.** Upper panel: the first nine's format; lower panel: the other's; each with par, S.I., yards and dots. One per sheet (Letter landscape: top 12.7; A4: top 9.75). The fold is a 0.25 pt dotted line marked "fold". |
| X2 | **A group card for 5 or more players** (a fivesome, or a group card where the organizer put 5–6 in one group) | 5 or more rows at 8.5 mm plus the header goes past 87 mm. | **Fold-out** as X1: rows 1–4 on the upper panel, the rest on the lower, with the hole, par and S.I. rows repeated. |
| X3 | **A team card naming 4 players with 3 or more tees in play and two-line names** | Only reached if the 2-line cap on side names cannot hold four names at 7.5 pt. `cardName()` initials normally prevent it. | **Fold-out**, with the names on the lower panel. The test fixture includes this case so that the fallback is what is tested. |
| X4 | **The starting sheet** | Not a card: it is a page for a noticeboard and the starter, read standing. | A full A4 or Letter portrait page, 30 rows a page, whole groups kept together. |

**Not exceptions:**
- **A 36-hole day** is two rounds, so it prints one normal card per round, never one long card.
- **Four-ball** prints per side (Rule 23.2b), so it always fits.

**The rule in code:**
- `cardFormat(rows, tees, kind)`, a pure function in `domain/print-kit.ts`, returns `"card"` or `"fold-out"`, with the reason.
- The hub names every fold-out ("2 cards print as fold-outs: Match 3, Match 4, because both formats are on one card").
- The sheet count includes them.

### 3.5 The overflow test (QA): strict, in the browser, at print size

**`e2e/print-kit-fits.spec.ts`**, run in Chromium, plus WebKit in the round:
- **Media:** `page.emulateMedia({ media: "print" })`.
- **Paper:** Letter and A4.
- **What it checks on every `[data-card]`, the normal card or the fold-out:**
  1. The trim box is 241.3 × 95.25 mm (or 241.3 × 190.5 mm for a fold-out), within 0.5 px, at 96 px per inch.
  2. Every descendant's `getBoundingClientRect()` sits inside the card's **safe box** (the trim inset by 4 mm), and no element has `scrollWidth > clientWidth` or `scrollHeight > clientHeight`.
  3. Every text node's computed font-size is at least 7 pt (9.33 px). A sign's code is at least 40 pt (53.3 px). Every QR is at least 30 mm (113.4 px).
  4. Cards per sheet: 2, or 1 for a fold-out. No `[data-card]` crosses a page boundary.
  5. A fold-out appears **only** for X1–X3. Any other fold-out fails: it would be a quiet shrink-around.

**The fixture matrix:**
- Invented `zz-print-fits` organization, `@example.invalid` addresses, deleted in `finally`.
- Holes: 9 and 18, plus a back-nine start.
- Groups and sides of 2, 3 and 4, plus one of 5 (X2).
- Formats:
  - individual stroke play;
  - Stableford;
  - group card;
  - four-ball (per side);
  - scramble with 4 names;
  - foursomes;
  - singles match (slip);
  - cup four-ball, all 18;
  - cup mixed day (X1).
- 1, 2 and 3 tees in one group.
- Names: the longest real-world shape, with a 59-character name and a hyphenated double surname.
- Club: a 60-character club name with no logo, and a very wide logo.
- Event: an 80-character event name.
- A "to be confirmed" handicap.
- A plus handicap.
- Two round codes on one sign.

**Controls, run first in the spec:**
- a page with a forced 200-character unbreakable name must be REPORTED by the measuring function;
- a card styled at 6 pt must be reported.

**Mutation, after committing:**
- shrink the trim CSS by 10 mm and the spec goes red;
- set `cardFormat` to always return `"card"` and X1 goes red.

**Kept:** the existing `e2e/print-kit.spec.ts` checks:
- QR decodes to exactly `/play#CODE`;
- never-on-paper with its control;
- reprint only what is stale;
- stamp on the club's clock under `E2E_TZ`.

### 3.6 Country words

- Every word a person reads goes through the golf-terms register: `golfTermsFor(golfRegister(country, override))` and `inClubWords`.
- `DOC_TITLE` becomes `docTitle(kind, words)`, with `signs: "{Cart} signs"`.
- The labels become `${g.name} — ${words.cart} sign`, and the page's MoreInfo and refusal text use `{cart}` / `{carts}`.
- `{Cart}` needs a capitalised token. Add it to `GOLF_TERMS` if it is not there; `golf-terms.test.ts` covers it.
- Comments may keep "cart", because `readSource` strips them.
- Run `npx vitest run src/lib/__tests__/country-words.test.ts`. It must be green, and it lists every remaining place.
- The guide already writes **{cart}**. Keep it that way.

### 3.7 The migration

- **Rename the folder** `prisma/migrations/A019_a_round_remembers_what_was_printed` to **`A031_a_round_remembers_what_was_printed`**, so it replays after main's A030. `migrations-replay-in-the-order-written.test.ts` holds that.
- **Make it idempotent:** `ALTER TABLE "Stage" ADD COLUMN IF NOT EXISTS "printLog" TEXT NOT NULL DEFAULT '';`.
  - The development database (and any preview database the branch built) may already have the column, recorded under the A019 name.
- **Development database:** if `_prisma_migrations` holds a row named `A019_…`, rename that row by hand to `A031_…`. That is a dev-only write: never a reset (Hard rule 6), never production. Then run `npx prisma migrate deploy`.
- **Production** never had A019, so A031 simply applies on deploy.

### 3.8 Slice 1 and later

**Slice 1: merges before the a pilot club setup week (Sat 14 Nov).**
- Target: merged **by Wed 11 Nov**. Hard cut-off: **Fri 13 Nov**.
- Scheduled **after G1**, as the next Engineer brief. G3, then G1, then the Print kit.
- It keeps **three rounds** (handicap arithmetic in `domain/team.ts`), so the build must be done by about **Sat 7 Nov**.
- Contents:
  - the country-word fix;
  - A031;
  - the normal card and two-up layout for all six cards;
  - X1–X4;
  - `cardName`;
  - the per-{cart} signs;
  - the sheet count on the Print button;
  - the calibration line;
  - the Reports door;
  - the overflow spec;
  - the guide, the PDF and the a pilot club cheat sheet.
- **If it misses 13 Nov:** a pilot club uses today's main. That means Round codes' round signs (full page), plus the club's own scorecards as the paper backup. Nothing goes in during the freeze (19 Nov – 1 Dec).

**Slice 2: December, after the freeze and after G1/G2.**
- The dashboard's on-the-day line.
- The Eagle-and-above footer switch (already ruled).
- The Results sheet and prize list under Reports.

**Later or parked:** see 3.2.

### 3.9 What a club prints

Per day, the evening before: scorecards (one per side, or per player for an individual day), one {cart} sign per {cart}, two spare signs, and the starting sheet. Never money, never a day's cards before its groups are final.

---

## 4. Engineer brief, PR #938, slice 1

Work in the #938 worktree. Read CLAUDE.md, then `docs/claude/what-the-tests-enforce.md`, `migrations.md`, `e2e-traps.md`, `playwright-runs.md` and `design.md`.

**Roles to consult:**
- Tournament Director: the doors and the documents;
- Golf Professional: the card rows;
- UI/UX: the layouts;
- QA: the spec;
- Customer Success: the guide and the cheat sheet;
- Ops: the migration.

Commit with explicit paths. Never stash. Do not push; QA gates and pushes.

1. **Migration.**
   - `git mv` A019 to `prisma/migrations/A031_a_round_remembers_what_was_printed`.
   - Change the SQL to `ADD COLUMN IF NOT EXISTS`.
   - On the dev database only, if `_prisma_migrations` has the A019 row: `UPDATE "_prisma_migrations" SET migration_name='A031_a_round_remembers_what_was_printed' WHERE migration_name='A019_a_round_remembers_what_was_printed'`.
   - Then run `npx prisma migrate deploy` and `npx prisma generate`, and restart any dev server.
   - Run `migrations-replay-in-the-order-written.test.ts`.
2. **Country words.**
   - `docTitle(kind, words)` replaces `DOC_TITLE`, and every caller takes the words (the compiler lists the callers).
   - The sign labels and the `/print` copy use `{cart}` / `{carts}`.
   - Add a `Cart` capital token if it is missing.
   - `country-words.test.ts` and `golf-terms.test.ts` must be green.
3. **Domain** (`domain/print-kit.ts`, pure, unit-tested):
   - `CARD_MM = { w: 241.3, h: 95.25, safe: 4 }` and `FOLDOUT_MM = { w: 241.3, h: 190.5 }`.
   - `SHEET_SLOTS[paper]`, holding the slot positions in 3.3.
   - `cardFormat(...)`, returning `"card" | "fold-out"` with a reason. It covers X1–X3 only.
   - `cardName(name, maxChars)`.
   - `sheetsFor(cards)`, the count for the Print button.
   - Unit tests are worked from the table in 3.3. Include the controls: a 5-row group card is a fold-out, and a 4-row card is not.
4. **Documents.**
   - Merge "group-cards" into "cards" with a per-player or per-group choice (individual formats only).
   - Four-ball becomes one card per side.
   - Signs become one per {cart} (pairs in tee-sheet order), with a "One per group (walking)" choice.
   - The starting sheet becomes a single copy with the tick column.
   - Keep the `/scorecard` redirect, pointing to `?docs=cards`.
   - Keep the fingerprint keys stable, or accept that the first print after deploy reads as "unprinted".
5. **Renderer** (`PrintPages.tsx`, `TeeSheetPrint.tsx` under `.pk-page`):
   - Sheets carry absolutely positioned `[data-card]` slots in mm.
   - Named `@page` rules: Letter or A4 landscape for cards, portrait for the starting sheet, `margin: 0`.
   - Crop marks and the dashed gutter cut, as in 3.3.
   - The 50 mm calibration line.
   - Layouts A–E exactly as in 3.3, plus the X1–X3 fold-out with a dotted "fold" line.
   - The 7 pt floor; the self-hosted condensed face via `next/font/local`; black on white; the club's theme kept off paper.
6. **Hub** (`PrintKitClient.tsx`):
   - "Print N sheets" on the button.
   - "Actual size (100%) · headers and footers off".
   - Name each fold-out and its reason.
7. **Doors.**
   - Reports Exports: a "Print kit" row ("Scorecards, {cart} signs and the starting sheet for a round") linking to `/print?docs=cards,signs,spare,start`. It replaces today's cards row.
   - Keep the Tee sheet, Team cup and Round codes links.
   - Do NOT touch the dashboard or the setup checklist (G1/G2).
8. **Overflow spec.**
   - `e2e/print-kit-fits.spec.ts`, exactly as in 3.5: the fixture matrix, the controls first, Letter and A4, Chromium plus WebKit (`E2E_ENGINE=webkit`, `E2E_PLAIN_HTTP=1`).
   - Fixture `zz-print-fits`: invented names, `@example.invalid`, deleted in `finally`, signed in with `signedInNow`.
   - Then the two mutations in 3.5, after committing. Record them as red, then restored.
9. **Existing tests.**
   - Update `e2e/print-kit.spec.ts` (page counts, the per-{cart} signs, and the removal of `group-cards`).
   - Run `print-kit-paper-equals-screen.audit.test.ts` with `vitest.audit.config.ts`.
   - Run `paperRefusals` with its control.
10. **Help and docs, in this PR:**
    - `guide-steps.ts` Part 5 "Print kit":
      - the card size and two to a sheet;
      - cut on the line;
      - print at 100% and measure the 50 mm line;
      - one {cart} sign per {cart};
      - Scorecards' per-player or per-group choice;
      - fold-outs, and when;
      - the Reports door.
    - Rebuild the guide PDF (`node scripts/build-guide-pdf.mjs`).
    - `player-help.ts`: check the wording around "the sign in the {cart}".
    - Mark `docs/print-kit-panel-2026-10-23.md` "Superseded 30 Oct" and add `docs/print-kit-panel-2026-10-30.md` (this ruling, no a pilot club specifics).
    - `TourneyHQ Documents\a pilot club outing - organizer cheat sheet (DRAFT).md` step 8: "Print kit → {Cart} signs, Scorecards, Spare sign, Starting sheet; print one sheet first, measure the 50 mm line, scan one QR."
    - PR line: "Help/docs: updated …". Ask Ajay whether the landing page should show the card.
11. **Gate.**
    - `npx tsc --noEmit && npx vitest run && npx next lint && NEXT_DIST_DIR=.next-ci npx next build`, then the audit config, then `npm run smoke:all`.
    - Playwright only after the fixture-turn message to any other session.
    - Then `npm run qa:changed`: expect THREE rounds because of `domain/team.ts`. Quote it in the PR.
    - Report the reach from `node scripts/e2e-coverage.mjs`.
    - **Before the PR:** export one Letter PDF and one A4 PDF of the fixture (invented names) for Ajay to print and hold up against a real scorecard.

---

## 5. Open questions for Ajay

1. Approve the normal card at 9.5 × 3.75 in, two to a sheet, after printing the sample.
2. The cup mixed-day card as a fold-out (X1), or yards off its face to keep it a normal card.
3. "Score card enhancements" (18 Oct, parked): what was meant.
