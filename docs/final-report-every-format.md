# The final report, for every kind of tournament

Approved by Ajay, 2026-10-19 ("go ahead"), after the team's recommendation: the
final report — built first for team cups — is widened to every tournament, and
only then given a step on the landing page ("16:30 · The report", an unedited
capture of the demo club's report, previewed to him first).

Order of work: the cup report merges → the contest sponsors (#892, #893) → this
→ the landing step.

## What stays the same as the cup report

The page (`FinalReport`), its stylesheet (`report/report-styles.ts`), its two
doors (`/live/<token>/report` behind the board's gate, `/cup/report` in the
console) and the story (`Event.reportRecap`, or one told from the results).
The rulings carry over unchanged:

- it reads like a real report — no "sample", no "AI", no committee actions;
- colour only where it carries a result;
- every word at 7:1; body 18px on a phone, nothing under 13px;
- one row per thing at every width (the points track was drawn as stripes on
  a phone until `keep-grid`; anything new that sits in an inline grid needs
  the same).

## What a non-cup report says, and where each fact comes from

Nothing here is worked out a second time. Every figure is read from the reader
the board and the honours board already use, so the report cannot disagree
with them ("one rule, one place").

| On the report | Read from |
|---|---|
| The champion, and their figure ("net 66", "38 pts", "won the final 2&1") | `suggestChampion` / `positionsFrom` (the honours board's) |
| Shared first place, said as shared — never broken by the report | the same; a countback the club published is the board's, not ours |
| Each round's result in one sentence | `resultLinesFor(state)` |
| The leaderboard: position, name, gross AND net (or points), to par | `standingRows(state)` — always gross and net where there are strokes |
| A knockout's champion and the final | `bracketResults` / the draw |
| A league's table at the end of the season | the season standings |
| Prize and contest winners (nearest the pin, longest drive, twos) | what the Prizes screen reads |
| Format and field | each round: basis, format, holes, allowance; the field size |

## Masthead

The champion takes the place of the cup score: the name large, their figure
under it, and a ribbon — "Wins the April Medal", or "Shared first place" for a
tie. A tournament still being played says "The results so far" and has no
ribbon, as an open cup does.

## Decided (Ajay, 2026-10-19: "go with your recommendations")

- **The whole field** on the leaderboard, not the top ten: a club sends the
  report to everybody, and everybody looks for themselves.
- **A tournament of several rounds**: one table of the totals, and each round's
  result as a sentence in the story (`resultLinesFor`).
- **A player with no position** (withdrew, no return, missed the cut) shows the
  board's own words for them, never a position.

## The conclusion: everything the tournament used (2026-10-21)

Ajay: "the Round/Tournament conclusion report providing the highlights and
player accomplishments, leaderboard movement, any schedule deadline … THE
REPORT CAN INCLUDE EVERYTHING THE TOURNAMENT IS USING INCLUDING MONEY … the app
should be able to produce that report and available in the report section
(auto send is the next)". The approved mock was the layout; numbers are a
figure and a sentence, never a chart.

The same report, widened — not a second one. Four parts, each section drawn
only when the tournament used that part of the app:

| Section | Appears when | Read from |
|---|---|---|
| Flight winners | two or more flights | `flightStandings` (Prizes' and Today's reader) |
| The draw | a knockout | the board's draws, with the margins on `BracketWinner` |
| How it was won, place after each round | more than one round in the table | a stroke board: the board ranked through each round (`loadEventState(eventId, throughStageId)`, the cut's reading), only players holding a place; a match league: `weekViewFor`'s chained standings. Movement by `movementBetween` |
| Each round | more than one round | `roundOutcomesFor` / `resultLinesFor` |
| Prizes and contests | a winner named | Prize rows; a contest's pot from `moneyFor` |
| Highlights, In numbers | any card | `report-highlights.ts` over `roundStrokes`, each round on `state.strokeCourseFor` |
| Best round | several rounds in one unit and length | each round's winner, from `roundOutcomesFor` |
| Biggest climb | a climb of two places or more | the movement |
| Skins | a club pot that is final | `skinsPotFor` (a provisional pot is left out, as `gameNets` leaves it out) |
| Side games | a pot the cards settle, or a Nassau | `sidePotResults`, `nassauBoard` |
| Entry fees and costs | a kitty, or shared costs | the fund (`floatSummary`), `moneyFor` expenses |
| Settle-up | anything owed | `moneyFor(...).transfers` |
| Coming up | a next round, a deadline, a club tournament taking entries, a pinned notice | the rounds' dates, `registrationStatus`, `Announcement.pinned` |

What a card cannot say is left out rather than guessed: a shared-ball round
(foursomes, a scramble) files a side's card with no player on it, so it gives no
birdies to anybody; and only a STROKE round's cards make a lowest gross, a best
nine, a run or a hardest hole — a four-ball partner picks up and a match
concedes holes.

**Who sees amounts** (decided by recommendation; the owner may change it): the
organizer's copy in Reports and a signed-in player in the field (their own line
first). The public link, signed out, names the winners only: no amounts, no
costs, no settle-up, no pinned notices. One rule, `showsAmounts(audience)`, in
`event-report-sections.ts`; `reportFor` defaults to the public copy.

**Walked before shipping, on the seeded club at 375px, and two things changed.**
The first draft read the week sheet's stroke table for the movement, which adds
up whatever cards each player has: on the 36-hole championship with a cut it
reported round two "led" by twelve players on gross 89 — their ONE round's total.
And a long list of names ("12 players each climbed 16 places") is said as a count
past three names. The audit test now takes a closed round's card away and asserts
that player tops nothing.

**Walked again on every seeded tournament, 2026-10-23, and the walk before
shipping had been of FINISHED ones.** Opened while a tournament is being played,
the report is "The results so far", and that state said things that were not so:

- the leader's figure was the part-played TOTAL ("Marnie leads on net 30 … Nkechi
  is next, on net 67" — six under through eight against four under through
  eighteen). A part-played card's figure is now what the board ranks it on, with
  how far round ("net −6 through 9", "10 points through 4", `placeFigure`); a
  shared place carries a figure only when everybody in it holds it on that figure
  (`sharedFigure`); the leaderboard gets a **Thru** column; somebody yet to tee off
  is "Not started", not "No return"; flights show their leaders;
- the movement and "played every round" counted rounds still on the calendar
  ("stayed top after Round 5 … 6 … 7"; "0 played every round"). A round nobody
  has played is in no table (`roundsWithResults`), and the last column is "Now"
  until the tournament is complete;
- a tournament nobody has played printed its field as "No return", and a knockout
  drawn in flights printed "The qualifying round" as 36 rows of dashes. No result,
  no table; no card, no "In numbers" (it read "0 birdies");
- a Nassau's round result was "3 bets" — now "3 games", and the side-game sweep
  catches the word as a whole string; a tie won on extra holes reads "at the 19th"
  (`marginWords` in `my-tie.ts`, the one reader of a tie's margin — the player's
  own line's wording; a second copy, `tieResultWords`, was folded into it when the
  knockout branch merged).

Tests: `the-report-while-it-is-played.audit.test.ts`, and cases in
`final-report.test.ts`, `report-highlights.test.ts` and `my-tie.test.ts`.

**Next: sending it.** The report is one `EventReport` value of strings, drawn by
one component with one stylesheet, so an email can render the same value. Not
built yet.

Tests: `report-highlights.test.ts` and `report-movement.test.ts` (worked by
hand); `final-report-reads-the-readers.audit.test.ts` (every section against
its reader, and the public copy, rendered, holds no money);
`e2e/final-report.spec.ts` (the organizer opens it from Reports; the public
link shows winners without amounts).

## The rich report — the panel's decision, 2026-10-23

Ajay: "make all the reports rich and add some graphics … I see reports for all
formats look same and I dont see a money part. include money only if the
tournament has it. so as other things", and "we need state of the art reports".
The panel: a golf professional, a tournament director, a data-visualisation
designer, the marketing manager and the QA manager. Their first finding: none of
the eleven `zz-five` test tournaments has a side game, a skins pot, a shared cost
or a contest — "no money part" was the DATA, not a defect.
`e2e/report-rich-fixture.mjs` now builds tournaments that have them (seeded and
kept under `zz-report` for the owner to look at: `node e2e/report-rich-fixture.mjs
seed zz-report`, and `teardown zz-report` to remove them).

**Decided.**

1. **Lead with the result in the format's own words, the prize list first**
   (`event-report-rich.ts`, `leadFor`): overall and each flight (a podium each up
   to four flights, the winner only past that); gross and net side by side for
   stroke play ("71 gross / 66 net"); points for a Stableford, never a to-par; a
   knockout's final in golf's words ("beat Bram in the final at the 19th"); a side
   with its members. A tie the BOARD placed on countback says where — "won on
   countback, back 9", "ahead of Edda on countback, last 3 points", on the net
   card for a net event — read off the board's own cards and basis
   (`state.countbackBetween`, over `countbackStep` in `stroke-countback.ts`, the
   one ladder). A tie the countback could NOT part stays shared ("Joint winners")
   until the committee confirms a champion on the honours board, when it reads as
   a play-off: the champion with the committee's note, the other "lost the
   play-off". The story moves below the prizes.
2. **One hero graphic per format** (`domain/report-graphics.ts`,
   `components/report/ReportGraphics.tsx`), chosen where the Rules make it mean
   something: the place after each round, top eight (two rounds or more, the cut
   marked; never one round, never match play); the hole-difficulty strip (one
   round, eight cards or more, average GROSS against par, picked-up Stableford
   holes left out — `pickedUpHoles` reads a pick-up back as the card does); the
   points as bars (Stableford); the winning side's card with whose ball counted,
   "both" where the partners were level (four-ball; foursomes and scramble show
   the side's card); the champion's path, an upset flagged only where a qualifying
   round seeded the draw (knockout); the table with a dot a week, Played, Points
   and the last week's ▲▼ (league: three rounds or more on a points or match
   board); the cup session by session as a tug of war with the points needed
   marked, and the match that clinched it (cup); the settle-up (casual round). At
   most the hole strip besides. No pie, no axes, no gridlines, never hue alone
   (under par solid, par blank, over par outlined and hatched; a birdie ringed and
   a bogey boxed, as a card marks them); figures 16px or more. Each is a
   `<figure>` whose caption says the finding, and whose figures sit in a table
   drawn from the SAME list (`fr-sr`: out of sight on screen, printed on paper).
3. **On the course**, next after the prizes, each only if it ran: the twos ("4
   twos, $5.00 each" — the share only once final, and only where it divides
   exactly), nearest the pin and longest drive with the hole.
4. **Money only once final, at the sink.** The side games are read from the
   money screen's own readers (`skinsPotFor`'s `provisional`, `sidePotResults`,
   `nassauBoard`'s completed segments — a finished front nine is reported while
   the back is played). While any of them can still change, the settle-up waits
   and one line says "Side games settle when the last card is in."; once nothing
   can, **Settle up** shows the fewest payments (`moneyFor(...).transfers`) and
   where everybody ends up (`moneyFor(...).standing`), with "Recorded by
   TourneyHQ. Settle between yourselves." under it. Never "bet", "pay me" or "won
   a pot". WHO SEES AN AMOUNT is unchanged (`showsAmounts`).
5. **A section only when the event has it** — swept format by section, each
   "not shown" with a control (`the-rich-report.audit.test.ts`).
6. **Handicaps**: each round's allowance in Format and field ("95% of
   handicap"), from `individualAllowanceFor` / `effectiveAllowance`; no index.
7. **The report's own share card** (`live/[token]/report/opengraph-image.tsx`,
   `domain/report-card.ts`): the club large, the event, CHAMPION — "Leads" while
   it is played — the figure, one highlight, TourneyHQ small. Its description is a
   news line ("Ailsa Thorne wins the Spring Medal after a play-off at Larchfield
   Links"); "Final report" in the title only once final. A board that is not
   public gets a card naming nobody; the card has no field an amount could ride in.
8. **The club first** on the masthead (name and logo, `brandForEvent`);
   "Results by TourneyHQ" once, small, at the foot — pointing at the early list
   while sign-ins are held and at the front door once the owner opens them
   (`report-foot.ts`, reading `signInsHeld`; nothing written for either state).
9. **What's next** last. A played four-ball round was "Coming up" on its own
   report: `state.roundsWithResults` does not read `TeamScorecard`, so the
   report's readers use `playedStageIds` (the state's other readers were not
   walked and are left alone).

A casual round has a report now: one short screen — the match's one line, the
settle-up as its picture, the side games, what's next.

**The reasons.** The professional: a results sheet is read top-down for the
prize list, and countback is the question at every prize-giving. The director:
margins, the play-off, the flight winners and the twos are what the committee
reads out. The designer: one graphic chosen for the format says something; a
page of charts says nothing. Marketing: the share card is the first thing
anybody outside the club sees, so it carries the club and the champion. QA: a
graphic is a second reader unless it is drawn from the table's own rows.

**Dissent.** The designer wanted a score-mix bar on every stroke report;
refused (the same at every club, and on a net event it reads as the net). The
marketing manager wanted the TourneyHQ mark on the masthead; refused (the
club's document). The director wanted prize money on the public link; that is
the owner's ruling (the report-settings slice offers it). Ajay rejected a
chart-heavy mock on 2026-10-21 as "very complex and hard to understand": read as
a ruling against MANY charts and axes, not against one labelled picture — each
graphic is one component to take out if he disagrees.

**Not built, said:** a play-off has no model of its own (the honours note is
the record); a position sparkline in a league with even attendance; a four-ball
"both" on a NET card (needs each partner's net per hole; the counted ball is
named); the cup report carries no money section.

## The report's settings, and a name withheld (2026-10-24)

The owner approved what the panel agreed, with its amendments.

- **One line on the report screen** says the settings in words ("Anyone with the
  board link can see this report · Side-game amounts: players only"); **Change**
  opens the choices; **See it as the public does** draws the visitor's copy in
  the console (`?as=public`).
- **Who can see the report**: "Anyone with the board link" (default) or "Players
  in this tournament" (`Event.reportVisibility`). Never more public than the
  board (`reportOpenToPublic`). A visitor it is not for reads "This report is
  shared with the players in this tournament" and a link to /play — no padlock,
  never "closed" or "private", no name. Players-only also takes the share card
  and the news line away.
- **Side-game amounts** (`Event.reportAmounts`): "Only players see amounts; the
  public sees the winners" (default, the rule before), "Nobody sees amounts —
  winners only" (the organizer's copy keeps them: it is the record), "Everyone
  sees amounts" (with "visible to anyone with the link" beside it). Read at the
  sink: `showsAmounts(audience, setting)` → `amountsShownTo`, the setting a
  required argument. The public copy never says that anything is left off it.
  The share card has no field for an amount, whatever the setting.
- **No handicap switch** (the panel dropped it).
- **"Don't show my name on public pages"**, on the player's entry (Registration;
  `Player.publicNameWithheld`; there is no player-side entry screen to put it on).
  Signed out — the public board, the public report, both share cards, the link's
  title and news line — they are "Player (name withheld)"; the field and the
  staff see the name. `publicName` reads the flag; `publicCopy`
  (`services/public-names.ts`) hands every signed-out page its data through
  `withholdNames`, whole names and the ladder's "Ailsa T." alike, as whole words.
- Migration `A020_a_report_says_who_may_see_it`. Both settings travel with a
  copied tournament (`clone.ts`).

Tests: `report-settings.test.ts`, `the-report-settings.audit.test.ts` (each
setting mutated and watched red; the default untouched; Save persists and refuses
a value off the lists; the withheld sweep with a flag-off control) and
`e2e/report-settings.spec.ts` (every signed-out page read for the name; the
players-only visitor; the organizer changing the settings and reloading). The
browser sweep went red with the public board not withholding.

## Tests owed

- Unit: the champion line for a win, a tie and an unfinished event; gross and
  net both on every row with strokes; a Stableford report shows points.
- Browser: the report of a finished medal, a Stableford and a knockout from
  the seeded club, at phone, desktop and 320px, with `fits` and the one-row
  track check where a track appears.
- A sweep: a new format added to the format list without a report line is red.
