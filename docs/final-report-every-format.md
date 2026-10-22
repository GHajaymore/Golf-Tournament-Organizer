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
| How it was won, place after each round | more than one round whose result is in the table | `weekViewFor` standings (`movementBetween`) per round; the Final column is the board's place |
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

**Next: sending it.** The report is one `EventReport` value of strings, drawn by
one component with one stylesheet, so an email can render the same value. Not
built yet.

Tests: `report-highlights.test.ts` and `report-movement.test.ts` (worked by
hand); `final-report-reads-the-readers.audit.test.ts` (every section against
its reader, and the public copy, rendered, holds no money);
`e2e/final-report.spec.ts` (the organizer opens it from Reports; the public
link shows winners without amounts).

## Tests owed

- Unit: the champion line for a win, a tie and an unfinished event; gross and
  net both on every row with strokes; a Stableford report shows points.
- Browser: the report of a finished medal, a Stableford and a knockout from
  the seeded club, at phone, desktop and 320px, with `fits` and the one-row
  track check where a track appears.
- A sweep: a new format added to the format list without a report line is red.
