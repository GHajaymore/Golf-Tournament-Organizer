# The Print kit — the panel's decision (2026-10-23)

## What was asked

For the club's own team cup on 18 October the cart signs and the match scorecard were made
**outside** the app, from its data. Ajay: "your cart sign was perfect so as the scorecard" — ruled:
keep those two shapes, do not redesign them. Then, 2026-10-23: "we need to produce similar or
suggested documents by the app from reports or whatever sections".

The panel — golf professional, tournament director, UI/UX and print designer, QA manager,
marketing manager — decided what follows. Slice 1 is built (this pull request); the later slices
are listed and are **not** built.

## The decision (slice 1)

**A. One renderer, two doors.** A **Print kit** item in the tournament's menu, under the Tee sheet
(`/print`): the secretary's morning checklist — every document the app can make for the round,
the round chosen, each ticked or not. The Tee sheet and the Team cup each have a **Print…** button
that opens the kit with their own documents ticked. There is no second print path: the Tee sheet's
old "Print scorecards" became the kit's **Group cards** (the same card, `TeeSheetPrint`), and the
round signs on Tournament details became the kit's **Spare sign**; both screens now link to the kit.

*Why:* two print buttons producing different groupings is how an organizer prints the wrong thing
on a Sunday morning (the reason the old `/scorecard` screen was folded into the Tee sheet in the
first place). One renderer means one answer on paper.

**B. The preview is the pages.** Each sheet is drawn at its true size on screen; an A4 / US Letter
switch starts from the club's country (US Letter in the Americas that use it, and for a club that
has not said — the app's default is the United States). Named `@page` rules give each sheet its
size and way up in one print job: scorecards and cup cards landscape, signs, slips and the starting
sheet portrait; one sheet per page, nothing split across a page break.

**C. The documents.**

1. *Named scorecards* by format (Rules 3.3b and 3.3b(4)): the competition, the date, the round, the
   tees, the player, the course handicap **and** the playing handicap (from the same chain the
   screens use), par / stroke index / yards, a dot per stroke by stroke index (two for two), boxes
   for the gross, marker's and player's signature lines. Stableford adds a points row "for
   Committee use". A four-ball: each partner's gross on a line of their own, either partner may
   sign. Foursomes / greensomes / scramble: one score per hole for the side. A shotgun or two-tee
   start prints the starting hole large. Match play: a **result slip** per match, signed for both
   sides (match play needs no card). A team cup: the **cup match card** the owner liked — landscape,
   one per match, and where a day plays singles on one nine and four-balls on the other, both
   nines' formats on the one card (the four-ball rows with dots off the low player, the better-ball
   and match rows, then the singles), with the club's stroke index and yards.
2. *Named cart sign* (the owner's shape), one per group from the **published** tee sheet (a cup:
   one per match): the group, each player's strokes as hole lists per nine, the scorer's job in
   plain words, the round code(s) at 40pt in a monospace face (the code alphabet has no 0, O, 1 or
   I to confuse), one QR per code (40mm, quiet zone of four modules, error correction M, black on
   white) to `/play#CODE` with the short address beneath. The nameless one-per-round sign stays, as
   the **Spare sign** for walk-ins and the starter's hut.
3. *Starting sheet*: time, starting tee or hole, group, names, playing handicap, tees — one copy for
   the noticeboard and one for the starter (with a column to tick), whole groups to a page.

**D. Stamp, and reprint only what changed.** Every page's footer: "Printed ‹club-clock time and
date› · version N · groups as of ‹when the sheet was saved›". The press of Print records what went
to the printer (`Stage.printLog`: per sheet, a fingerprint of everything drawn on it, its version
and when). When the groups, tee times, tees, a handicap or a round code change afterwards, the kit
and the Tee sheet say "N printed sheets are out of date — reprint these", name them, and print just
those as the next version. A reissued code is already refused by the app; its signs are flagged.

**E. Paper style.** Black on white; no tinted ground behind text; rules of at least half a point;
names at 14pt or more, body at 10pt or more; strokes as solid dots, never colour; the club's theme
colour stays off paper. The club first: its logo top-left at full size, else its name in type; the
competition as the headline. TourneyHQ is one small grey footer line on every page — "Scored live
with TourneyHQ · tourneyhq.club/play" — never in the header, never near the scoring area. Every
printed TourneyHQ address goes to `/play` or the club's live board, never the front door. (The
panel's wording of the line ended "tourneyhq.club"; that address is the front door, which rule E
forbids, so the line points at `/play`.)

**F. Never on paper.** Phone numbers, emails, postal addresses, prices, fees, stakes or side-game
money, "free", "sign up", a launch date, "bet", withdrawn players, a handicap the Committee has not
confirmed (printed "to be confirmed", with no strokes). `paperRefusals` sweeps every text on every
page in the browser test, with a control; the kit runs the same sweep over the words it is about
to print and the hub says what it found (a member typed in with an email for a name).

## The tests (the QA manager's list)

- Paper equals screen, hole by hole, for stroke play gross and net, Stableford, four-ball at
  stroke play (85%) and in a match (90%), foursomes, greensomes, scramble, a lady on the higher-par
  tees, a plus handicap, 54, a back nine and a nine-hole round, and singles match play
  (`print-kit-paper-equals-screen.audit.test.ts`). It found one fault on its first run: the entry
  screen drew a plus handicap no strokes given back in a four-ball medal while the board took them
  (`matchStrokesPerHole` floored the difference at nought); fixed in `domain/team.ts`.
- The PDF at A4 and Letter: a page per sheet, each the right way up, nothing running off a page, a
  59-character name in its box, every QR decoded to exactly `/play#CODE`, the never-on-paper sweep
  (`e2e/print-kit.spec.ts`).
- Stale: a moved group names exactly its sheets and "Reprint these" prints only them; a reissued
  code flags the signs.
- The stamp on the club's clock (`E2E_TZ` for the browser and the club; the server stays where it is).
- Field sizes 1, 2, 3, 5, 10, 20 and 120 off a shotgun.

## Later slices (not built)

- Results sheet and prize list under Reports: gross and net, countback marked, divisions.
- Knockout draw sheet from the Bracket screen with play-by dates (another branch is rebuilding the
  bracket; this one stays out of its files).
- Rules of the day / conditions of competition, including the tie and countback method — may sit
  on the back of the card.
- A poster and a one-pager in the club's voice: "‹Club› presents …", "Follow it live — scan here",
  "Who does what", "How the day works".
- Two-up A5 with a cut line.
- A pin-sheet template, last.

## The open question for the owner

**May a club remove the TourneyHQ footer line — for example on a paid plan?** Not decided here.
Until Ajay rules, the line is on every printed document.
