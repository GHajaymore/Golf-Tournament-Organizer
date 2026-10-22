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
| Prize and contest winners (nearest the pin, longest drive, twos) | what the Prizes screen reads, in the committee's list order. Under "one prize per player" no player is named for two PLACING prizes (the award is refused); a skill prize or a contest may name a placing winner again, as clubs allow |
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

## Tests owed

- Unit: the champion line for a win, a tie and an unfinished event; gross and
  net both on every row with strokes; a Stableford report shows points.
- Browser: the report of a finished medal, a Stableford and a knockout from
  the seeded club, at phone, desktop and 320px, with `fits` and the one-row
  track check where a track appears.
- A sweep: a new format added to the format list without a report line is red.
