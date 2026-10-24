# One rule, one place

Ajay, 2026-10-13: "make sure the underlying pieces/modules are in line and built
as shareable vs every screen/function/round using different logic or their own
way", and "start from the basic and then move step by step up".

This is the worklist for that. It exists because of one evening: fixing the
strokes for tees of a higher par turned up **thirteen** places that each worked
out what a player plays off in a round, **nine** that built their handicap lists
from **five** different groups of players, **five** that worked out a flight's
tees, and **three** doors that set a player's tees without the organizer. The
browser tests found none of it, because every screen was right on its own terms.
Two screens answering one question differently is the class a screen test cannot
see.

## The method, for every rule

1. **One function holds the rule**, and takes what it needs as REQUIRED
   arguments, so the compiler lists every caller the day the rule grows.
2. **One test worked from the Rules of Golf**, by a route the code does not
   take, on the axis the fixtures have been missing.
3. **One sweep that refuses a second copy**, with a control proving it can see
   one.

A reader that is deliberately kept separate (the board's `loadEventState` beside
`roundCourseHandicaps`, pinned to each other by the `every-reader-*` tests) is
not a defect: it is the comparison that consolidation would take away. It is
listed so that the decision is visible, and it must be pinned to the RULES, not
only to its twin.

## The order: from the bottom up

Each layer is taken only when the one beneath it is in one place and proven.

| Step | Layer | The question | State |
|---|---|---|---|
| 1 | What people type | handicaps, scores, money, dates read one way everywhere | done 2026-10-13 for every typed figure; reading a STORED card moved to step 5. **Re-measured 2026-10-23**: sweeps green; a typed match margin no match can finish on was accepted (found by a property test, see step 6) |
| 2 | The field | who is in the tournament, and in this round | done 2026-10-14: the cut recorded and asked once; a player found by address one way; a round's cut settings read once; leaving the field asked once. **Re-measured 2026-10-23**: sweeps green; 2 new inline `status: "confirmed"` reads, the one spelling — consistent |
| 3 | The venue | which course, which card, which tees | done 2026-10-14: tees; a round's card built one way; the handicap record off the round's tees. One item measured unreachable and registered (a match countback's card). **Re-measured 2026-10-23**: sweeps green; no new card chain or tee resolver in the 18,384 lines added since |
| 4 | Handicap | course handicap, playing handicap, strokes per hole | done 2026-10-14: one chain for a round (a singles match from its cards fixed); the tee-name pipeline and the handicap record checked. **Re-measured 2026-10-23**: sweeps green; no hand-written allowance added; property-tested against the Rule in whole numbers |
| 5 | A card | gross, net, points, to par | done 2026-10-14: what a stroke can be asked one way; the loops and to-par measured consistent on that footing. **2026-10-23**: the strokes received over the holes played is one function (`strokesReceivedOnHolesPlayed`) — a new copy in the cup's card line and the low-net pot's own, folded |
| 6 | A round | finished or not, ranking, ties, a match result | done 2026-10-14: a match result a card of its length, over when decided; a confirmed result stays confirmed; every board places by countback, decided once; three dead twins deleted. **2026-10-23**: "is this match over" asked of `matchIsOver` everywhere (5 direct `.complete` reads folded, 2 of them writers; sweep added); a margin no match can finish on refused |
| 7 | Across rounds | cut, flights, brackets, season table | done 2026-10-14: the cut and its field (step 2), a round's name (a cut's refusal fixed), a knockout's draw (2026-10-12); the week sheet's stroke table is the board's (2026-10-21). **Re-measured 2026-10-23**: no index-derived round name, no second countback; property-tested (cut and ties, a draw of 1 to 256 in any order) |
| 8 | Money | pots, splits, who owes whom | **done 2026-10-23**: one divider (`splitExactly`), one settle, one pot size (`potCents`, 6 copies folded); one table of when each game pays (`SIDE_GAME_PAYS`); every game worked by hand from its own rules; no pot arithmetic outside the money module, and no payment that moves money (sweeps). The report's side-game line fixed |
| 9 | What screens say | two screens never give different answers | begun 2026-10-14 (`e2e/the-boards-agree.spec.ts`). **2026-10-23**: a player's place on the secretary's board, the public link, Today and both copies of the report, and their money on three screens (`every-screen-gives-a-player-one-answer.audit.test.ts`); a knockout's draw, finishing order and progress (`a-knockout-is-read-one-way.test.ts`) |

Steps 3 and 4 were opened first only because the fault that prompted this was
found there. The work goes back to step 1 and climbs.

## Done so far

- **A number somebody typed** (step 1): `readDecimal` and `readWhole` in
  `domain/decimal-text.ts`, which say BLANK, a number, or UNREADABLE — never a
  silent 0 — and `readHandicapIndex` / `indexRefusal` in `domain/handicap-label.ts`
  for the one range a golfer's index can have (+10 to 54), the same in the box
  and on the server. The inventory counted 48 places reading a typed number their
own way; the change took out 40 lines holding one, on 21 screens, and the three
handicap readers became one (counted off the diff, not the inventory). The four
  actions that store an index refuse one outside the range. Money keeps its own
  reader (`minorUnitsFrom`) and dates their own (`date-words.ts`); both were
  already one. `a-typed-figure-is-read-one-way.test.ts` refuses `parseFloat`,
  `parseInt` and `Number(` anywhere on a screen except a list of lines nobody
  typed (a dropdown, a slider, a length off the stylesheet), each with its reason.
  What it found, live in production until it ships: clearing a casual round's
  handicap box made the player scratch; any number was stored as an index by
  four actions; an emptied price on the owner's screen saved the plan as free;
  a percent typed "12,5" in a shared cost read as 0; "7l.3" and "13O" in a
  course rating read as 7 and 13. **Not closed:** the owner's pricing screen has
  no browser test, so the emptied-price fix is held only by the sweep holding
  it to the shared reader, not by anything that presses Save.
- **Whether a cut has been made** (step 2): `cutHasBeenMade` in
  `domain/cut-ready.ts`, reading `Stage.cutMadeAt` (migration
  `A000_stage_cut_made_at`), which `applyStrokeCut` writes the first time.
  Four readers inferred it from "the round holds a card" and part of them from
  "the round before is closed": the player app, the dashboard's field size, the
  missed-cut list, the no-card list and the shared costs' field now ask the one
  function. What it found: a card started in round 2 before round 1 closed made
  itself the whole field ("1 of 1"), the round's pots waited for that one card,
  and the player — if the cut then left them out — came through it anyway,
  ranked. The first cut now takes such a card out and lists its holes in Recent
  changes; a re-made cut keeps a card somebody was told to play.
  `a-cut-is-made-once-for-every-reader.audit.test.ts`; 8 of 11 breaks caught on
  the first try, and the two the fixture could not see made it stronger.
- **A player found by address** (step 2): `byAddress(email)` in
  `domain/my-entry.ts`, spread into the query. 27 player queries in 23 files
  wrote the match out for themselves — the "me" readers the inventory named
  and twenty more it had not — and most had no refusal for an empty address,
  which matches every entry made without one: one person would be handed every
  address-less player's card, match and money. Not live (sessions carry a real
  address), and nothing stopped it. For an empty address the piece is a
  condition no row meets, so there is nothing for a caller to forget.
  `my-entries-are-asked-one-way.test.ts` refuses another;
  `an-empty-address-is-nobody.audit.test.ts` proves it on real rows against the
  old query, which finds both address-less players.
- **A round's cut settings, and the cut a round is played for** (step 2):
  `cutRuleOf` is the one reading of `cutScope` / `cutMode` / `cutCount` /
  `cutPercent` (four copies became one; `a-cut-rule-is-read-once.test.ts`), and
  `cutAfterRound` is the cut made AFTER a round. The sweep for a fifth copy
  found the rules sheet reading them for itself, off the round being played —
  which is the cut INTO it: no cut printed while round 1 was played, a cut
  promised once round 2 had begun, and no "in each flight" or "and ties".
  `e2e/the-cut-a-round-is-played-for.spec.ts` reads it as the organizer and a
  player, in its own throwaway medal with round 1 in play.
- **Leaving the field** (step 2): three inline copies of "withdrawn or
  disqualified" ask `hasLeftTheField` / `LEFT_THE_FIELD`;
  `left-the-field-is-asked-one-way.test.ts` refuses a fourth. Places that say
  something different to each (which way back there is) are a different
  question and were left.
- **A round's card, and the tees of a member's differential** (step 3):
  `roundCard(stage, event, venue)` in `course-resolution.ts` is the one chain
  from a round to its card — nine readers wrote it out
  (`a-rounds-card-is-built-one-way.test.ts`). The handicap record now walks the
  round's tees as the board does (`teeForPlay`); it had rated a round played
  away off the home course's tees, 22.0 where the Rule gives 13.4
  (`a-differential-is-from-the-tees-of-the-round.audit.test.ts`). Live
  2026-10-14.
- **What a stroke can be** (step 5): `isStroke` in `domain/score-payload.ts`,
  a whole number from 1 to `MAX_STROKES_PER_HOLE`; every writer of a card asks
  it, and `a-stroke-is-one-test.test.ts` refuses the range written by hand (a
  file of cards had it twice with its own 30). **Checked and consistent** (step
  5), on that footing: the card loops that call a hole played when `s != null`
  and the ones that want `s > 0` cannot disagree, because no stored card holds
  a 0 — 28,395 cards measured, read-only, on 2026-10-14, and nothing but 1..30
  or empty in any of them. The eight to-par sums are each "strokes minus par
  over the holes played" and agree on that footing; they were left as they
  are rather than rewritten on a difference that cannot arise. The low-net pot's
  net is the board's: `state.strokeHandicapFor` off `roundCard`, gross less the
  rounded strokes received over the holes played.
- **Checked and consistent** (step 3): the map of each player's flight tees is
  built four times, all four the same one line (a flight's id to its tees, then
  each player through their flight); which tees WIN is `teeIdFor`'s alone.
  **Measured and registered** (step 3): a halved match's toughest-holes
  countback reads the tournament's card in all three readers; no tournament
  uses that countback, so nothing can show it — see `docs/deferred-register.md`.
- **Checked and consistent** (step 2): "confirmed" is spelled one way in
  every query that asks for the field (`status: "confirmed"`), and the two
  readers of "who contested the last round" — the round-robin cut and the
  board's highlight of it — count the same round's matches.
- **Checked and right as written** (step 2): `player-access.ts`'s
  `status: { not: "withdrawn" }` asks who still needs an address's sign-in, and
  a disqualified player keeps theirs on purpose (they can still owe or be
  owed); `roster-link.ts`'s `live` keeps a disqualified member out of "add",
  because they are reinstated through the disqualification, not by a second
  entry. Both look like the spelling `left-the-field.ts` warns about, and both
  answer a different question. Do not "fix" them.

- **Playing handicap in a round** (step 4): `roundPlayingHandicap`, required
  third argument; `tees-of-a-higher-par-get-their-strokes.test.ts` refuses the
  bare allowance anywhere a round is priced. Thirteen places, one function.
  **And since 2026-10-14 one CHAIN**: `playingHandicapInRound(round, row,
  member)` in `round-allowance.ts` (with `playingHandicapPartsInRound` for a
  screen that lists the parts) is the round's figure, its allowance and the
  strokes for the pars, in that order; ten callers, and
  `a-round-is-priced-one-way.test.ts` refuses `roundPlayingHandicap` anywhere
  else but the spread inside a team card. It had been written out nine times,
  and the ninth — the stored result of a singles match decided from its two
  cards — had the first step alone: a woman off the par-72 reds was shown a
  stroke against a man off the par-71 whites, on the scorer's screen and her
  own, and her 1-up win was stored as a half
  (`stored-results-give-the-strokes-for-the-pars.audit.test.ts`). The guide had
  said all along that a match gives the strokes. `roundHandicapOf`, left with no
  callers, is deleted.
- **The field for the lowest par** (steps 2 and 4): `roundCourseHandicaps`
  requires `field`; `confirmedField(eventId)` supplies it. Nine readers, one
  field.
- **Which tees a player plays** (step 3): `teeIdFor` with the ladies' rung as a
  required argument; every reader of a round selects `FIELD_PLAYER`.
  `the-organizer-decides-the-tees.test.ts` allows one write of a player's tees in
  the whole app.
- **What a figure says about itself** (step 9, 2026-10-24): `lib/domain/figure-working.ts`
  words every "why" a screen opens — a stroke dot (`strokesOnHole`, which the
  player's card now allocates its dots WITH, so it left the `holeStrokesReceived`
  debt list), a card's totals and net (`cardFigures`, `cardWorking`, one call for
  the scorecard and the strip above the hole), a playing handicap from the
  round's parts (`strokeHandicapPartsFor`, of which `strokeHandicapFor` is the
  `.playing`), Stableford points through the per-hole tables `cardPoints` adds,
  and a board's tie from `countbackBetween` — the decision the rank pass places
  by, of which `countbackCompare` is the `.order`. `every-figure-explains-itself.test.tsx`
  reads each sentence back and holds it to the figure on the rendered screen and
  to the Rule, and refuses a Rule's citation written anywhere else.
- **Deleted, with no callers**: `courseHandicapForPlayer` (a fourth course-handicap
  pipeline) and the tee matcher with its module.

## The re-measure of 2026-10-23 (`docs/foundation-pass-2026-10-23.md`)

Thirty-six merges had landed since step 9 was begun — the tournament report,
the cup's stroke-card keeping, a match's own page, side-game work. Every sweep
above was run again (all green, on 12,640 unit tests), and the 18,384 lines of
source added since 2026-10-14 were scanned for sixteen shapes of a second copy:
an allowance by hand, a round figure by hand, a stroke allocation, a ranking
sort, a place numbering, an inline field, a left-the-field spelling, a round
named by its index, a platform date, a match's `.complete`, a card chain by
hand, a money split, a stored card parsed, a to-par by hand, a countback, a
typed number. What was found, each read by hand before it was counted:

| Shape | Found | Done |
|---|---|---|
| `resolveMatch(...).complete` read directly | 5 (2 writers: the team and singles match rebuilt from cards) | folded into `matchIsOver`; `a-match-is-over-is-asked-one-way.test.ts` |
| strokes received over the holes played, looped by hand | 2 (the cup's card line, the low-net pot) | `strokesReceivedOnHolesPlayed`; the low-net pot leaves the allocation debt list |
| a pot multiplied out by hand | 6 (one of them wrong: the report) | `potCents`; `money-is-worked-out-in-one-place.test.ts` |
| a countback worded twice (`tie-words.ts`, the Stages screen) | 2 | left: two questions (a match's tiebreak, a stroke card's countback), each read off its own rule |
| an inline `status: "confirmed"` | 2 | left: the one spelling (step 2) |
| birdies counted again (the report's highlights) | 1 | left: a highlight counts birdies exactly; the pot counts one under or better, by its own rule |

And a property test (step 6) found a typed margin accepted that no match can
finish on. The detail, and the mutation scores, are in the pass's own note.

## The inventory

A read-only sweep on 2026-10-13. Paths are under `src/`. Counts were confirmed
by reading the code, not taken from a search; "no guard found" means none was
found by searching for the rule's function names. Line numbers are as of that
day and will drift: search for the expression.

## By layer (Ajay's bottom-up order)

### 1 What people type
- Money: `minorUnitsFrom` (domain/money-format.ts:202) via `useMoney().parse` / `stakeMinorUnits`. Outside it: components/PrizesClient.tsx:94, 159 `parseFloat` on prize amounts.
- Handicap index, THREE readers: `parseHandicapInput` registration-intake.ts:143 (refuses out of range); `parseHandicap` quick-match.ts:641 (clamps, gives 0); CasualRoundPanel.tsx:250-256 inline (no range check). Whole strokes: `parseStrokesInput` handicap-label.ts:73.
- Course rating: `parseFloat(decimalPoint(x)) || 0` three times (TeeEditor.tsx:100, 121; VenuePrompt.tsx:238); slope and par `parseInt(...) || 0` (TeeEditor.tsx:101-102, 120-122; VenuePrompt.tsx:239-240). Accept trailing junk.
- ScoringClient.tsx:90 `parseFloat(raw)` (points settings).
- Reading a stored card: 42 inline `JSON.parse(x.strokes|holes)` in 22 files (expenses.ts 7, entry/page.tsx 5, tournament.ts 4, actions/tournament.ts 4); some throw, some give []. No shared reader (`parseHoles` tournament.ts:179 is private).

### 2 The field
- `confirmedField` services/handicaps.ts:409 (new); `state.confirmed` tournament.ts:1115; `hasLeftTheField` domain/left-the-field.ts; `myPlayerIds` services/me.ts:62; `strokeCutField` stroke-cut.ts:212; `survivors`/`fieldEnteringRound` domain/cut.ts.
- ~42 bare inline `where: { eventId, status: "confirmed" }` (66 status reads in all).
- Inline twins of `myPlayerIds`: dashboard/page.tsx:630; entry/page.tsx:72; game-access.ts:109; player-prizes.ts:33; availability.ts:185; actions/skins.ts:426.
- Left the field inline: tournament.ts:1234; tournament-result.ts:315; expenses.ts:1170. The spelling left-the-field.ts calls wrong is still at player-access.ts:63 (`status: { not: "withdrawn" }`) and domain/roster-link.ts:110.
- Field of a round after a cut, SIX versions with different conditions: stroke-cut.ts:212-223; tournament.ts:2188-2198; tournament.ts:1660; tournament.ts:2847; expenses.ts:493-496; club-events.ts:300-318.
- "Who contested the last round": regroup.ts:590-598 and tournament.ts:2507-2512.
- Cut rule object built four ways: cut-ready.ts:9 `cutRuleOf`; cut.ts:239; cut.ts:307; regroup.ts:613-620.

### 3 The venue (course, card, tees)
- Tees: `teeIdFor` is the only resolver. Round's tee bypassing `teeForPlay`: handicap-record.ts:198, 207 pass `event.defaultTeeId` raw. Flight-tee map built FOUR times (five before `courseHandicapForPlayer` was deleted on 2026-10-13): handicaps.ts (canonical `flightTeeByPlayer`); handicaps.ts in `handicapsForRound`; tournament.ts:1224 (documented separate); handicap-record.ts:150.
- Card: chain `cardForStage(courseForRound(venue, event) ?? resolveCourse(event), stage)` hand-assembled at foursomes/page.tsx:238; actions/tournament.ts:3261, 5444; expenses.ts:845; league.ts:154; skins-pot.ts:254-270; tournament-result.ts:62-65; round-card.ts:43; handicap-record.ts:172.
- Event-level stroke index for match tiebreaks: tournament.ts:1335; regroup.ts:517 (documented); week-view.ts:239 (documented); head-to-head.ts:76 (no documented exemption).

### 4 Handicap
- Course-handicap conversion, FOUR pipelines: `courseHandicapMap` (boards, pots, sides; carries 6.2b); `handicapsForRound` -> `explainHandicap` handicaps.ts:146 (tee name / "rated" at entry/page.tsx:531, me/card/page.tsx:409, `teeNamesForRound`); `courseHandicapForPlayer` (had no callers; DELETED 2026-10-13); handicap-record.ts:227. The last three give no 6.2b strokes.
- Playing handicap in a round: five readers pinned by every-reader-*.audit tests (deliberately unmerged). Since 2026-10-14 their ARITHMETIC is one function, `playingHandicapInRound`; what each reader hands it (which tees, which field, which row) is still its own and still pinned by those tests. Because they now agree by construction, the function is pinned to the Rules by hand in `a-round-is-priced-one-way.test.ts`.
- Deferred register: a singles net match is derived with no allowance while its screens apply one. CLOSED 2026-10-14 — and it was the strokes for the pars that differed, not the allowance; one chain now (`playingHandicapInRound`).

### 5 A card
- Per-hole formulas are single (`stablefordPointsForHole`, `modifiedStablefordForHole`, `holeStrokesReceived`). But the LOOP over a card is written six times: `computeStrokeCard` stroke.ts:115; `aggregateStroke` stroke-agg.ts:176; `cardPoints` card-points.ts:19; points-standings.ts:221-236; expenses.ts:1018-1027 with derived-games.ts:131 (low-net pot); team.ts:106-127, 265-276. They disagree on a played hole: `s == null` (stroke.ts:167; points-standings.ts:227) vs `s <= 0` (stroke-agg.ts:221; card-points.ts).
- To-par: EIGHT places, no shared function: stroke.ts:198; stroke-agg.ts:225 + tournament.ts:2208; stroke-countback.ts:249; team.ts:172; team.ts:285; PlayerCard.tsx:222-237; ScorecardTable.tsx:349-363, 569; HoleByHoleCard.tsx:271-281 (`== null`, so a 0 counts).

### 6 A round
- Finished: ~14 named predicates + ~30 inline. `resolveMatch(...).complete` read without `matchIsOver` (an empty [] card reads complete and halved): domain/standings.ts:108-120, 295; tournament.ts:2566, 3534; single-match.ts:76-79; tournament-result.ts:161-163; finish-order.ts:38; actions/tournament.ts:2356, 2962, 3382; ScoreEntryClient.tsx:274, 490.
  **Measured 2026-10-14**: 0 of 6,528 stored matches hold `[]`, and every creator writes a card of blanks, so those readers cannot meet one in what is stored. Two WRITERS could store one, and did not clean what they were sent: `saveMatchHoles` (an empty list read as finished, scored and queued for sign-off; `["A"]` as an eighteen-hole match won 1 up; a hole that is not a result stored) and a file of hole-by-hole results (an empty row stored as `[]` and stamped scored). Both now clean to the round's length and ask `matchIsOver` (`a-match-result-is-a-card-of-its-length.audit.test.ts`). And the round-code door asked "every hole filled", so a match won 5&4 could not be handed in whole and was never stamped scored; it asks `matchIsOver` now, and its screen `matchIsOverAfter` (`play-score-entry.audit.test.ts`, `render.test.tsx`). **Not covered by any test**: the round-code screen's hold-back of a decided card under whole-round entry (a break of it was NOT CAUGHT); a regression costs a player a few taps, or the Final result box, and not a result.
- "Any stroke": `> 0` at cut-ready.ts:126; stroke-cut.ts:180; round-cards.ts:112 vs `!= null` at expenses.ts:513, 557; skins-pot.ts:291, 545; domain/skins-pot.ts:103; points-standings.ts:152; playing-history.ts:113.
- "Card full": scorecard-write.ts:97; actions/tournament.ts:2798; PlayerCard.tsx:208; PlayClient.tsx:549; tournament-switcher.ts:91; actions/play.ts:229.
- "Round official", two spellings: `closedAt != null` (leaderboard/page.tsx:233; me.ts:492, 634; expenses.ts:823, 1963; week-view.ts:484) vs `closedAt || event.status === "completed"` (expenses.ts:543, 1994; tournament-result.ts:263, 279, 355).
  **Checked and consistent** (2026-10-14): completing a tournament closes every open playing round, nothing else writes "completed", and 0 open rounds in 135 completed tournaments (read-only). The two spellings agree on everything stored.
- Ranking: ~12 orderings, 4 numbering routines, no shared comparator. Individual stroke: tournament.ts:2271-2362 inline comparator + rank pass (twin `rankByCountback` has no callers but its test). Modified Stableford points-standings.ts:254 inline. Team teams.ts:555 (no countback). Prize pickers prizes/page.tsx:99-105 inline sort on raw gross/net, no countback. TWO exported functions both named `compareOnBasis` (stroke-countback.ts:256 relative to par; week-basis.ts:179 raw). Place numbers come from components via `placesByValue` with each caller's own rule.
  **Done for the stroke board and the prize pickers** (2026-10-14): the board's sort and rank pass take the basis (`orderOn`), and the pickers ask it for gross and for net (`strokeStandingsOn`), so a tie for Best gross in a net medal goes to countback on the gross cards rather than to T1 (`a-gross-prize-tie-goes-to-countback.audit.test.ts`). **And the team boards and Modified Stableford** (2026-10-14): six readers numbered team sides on the figure alone, and the team sort broke a net tie on GROSS; the Modified Stableford board broke a points tie on the lower gross while its three readers shared on points. Both now order level rows by countback on their own card and decide the place where the rows are built (`TeamStanding.place`, `ModStablefordRow.place`); every board, sheet, export and Today screen prints it (`a-side-is-placed-by-countback.audit.test.ts`, `a-points-board-is-placed-by-countback.audit.test.ts`, sweep `a-side-is-placed-once.test.ts`). Still their own, on purpose: skins (a tie in skins is shared) and a pairs' season total, neither of which has one card to count back on. **A league's season table was on that list until 2026-10-21, on a false premise**: a stroke or points season DOES have a card to count back on — the board counts back on the last round, as a multi-round competition is decided — and the week sheet was building its own table besides (see layer 7).
- Match "confirmed or auto-confirmed": actions/tournament.ts:2556, 3628, 3581; match-filter.ts:39; ScoreEntryClient.tsx:2051; beside `effectiveScoreStatus`.
  **Done** (2026-10-14): `disputeMatch` read the stored column, so a player could dispute a result that had auto-confirmed; it reads `effectiveScoreStatus` now, as `clearMatch` does (`an-auto-confirmed-result-is-not-disputed-by-a-player.audit.test.ts`), and `auto-confirmed-is-never-stored.test.ts` refuses the column being compared with that word. The rest are handed the effective status already.

### 7 Across rounds
- See the cut-field six versions (layer 2) and cut rule four builders.
- Round label: `roundLabel`; index-derived outside the guard's pattern: week-view.ts:602, 619; availability.ts:289; cup.ts:91, 314 (two copies); regroup.ts:567; EntryModes.tsx:397.
  **Checked** (2026-10-14): the week, availability and voice numbers count the list they are about. Fixed: a cut's refusal numbered the round among round robins only ("Round 1" for the board's Round 2); the cup's session name was written twice.
- The table after a round, two builders: the board (`loadEventState(eventId, throughStageId)`, what the cut is made on) and the week sheet's stroke season table, which summed each player's cards and ranked the totals.
  **Done** (2026-10-21): the week sheet asks the board through `standingsThroughRound` (`services/standings-through.ts`) — only the players the board gives a place, the board's place and the board's figure (`strokeRankingBasis`). Before it, the seeded Club Championship's "standings after round 2" were led by the twelve who missed the cut, on one round's gross, and a stroke league member who skipped a week went top for it. Pinned from Rule 3.3a on a cut, a no-show, a missed closed week, a missed open week and a live round (`week-table-holds-only-a-place.audit.test.ts`); the sweep `a-stroke-table-across-rounds-is-the-board.test.ts` lists every caller of `aggregateStroke` with the one round it sums. A match league's table is untouched: it was already the board's chain (`chainRoundStandings`).

### 8 Money
- `splitExactly` is the only divider; `settle`, `gameNets` single. Inline: MoneyClient.tsx:142 (preview label). Low-net pot computes its OWN net (expenses.ts:1018-1027 + derived-games.ts:131 `gross - Math.round(c.strokesReceived)`) rather than the board's.
  **Done 2026-10-23**: `potCents` sizes every pot (six copies folded); `SIDE_GAME_PAYS` (money-layout.ts) is the one table of when each game's amount may be reported, read by `gameNets` and `saveSideGame`; the low-net pot's strokes through `strokesReceivedOnHolesPlayed`. Sweeps: `money-is-worked-out-in-one-place.test.ts` (no pot arithmetic outside the money module — the preview label is its one listed exemption; one split and one settle; only billing imports a payment provider; nothing makes a transfer, payout, charge or payment link). By hand: `side-games-by-their-own-rules.test.ts`. As properties: `properties-money.test.ts`.

### Dead twins of live rules
All four deleted: `courseHandicapForPlayer` (2026-10-13), and `rankByCountback`, `seasonPosition`, `isMatchStarted` (2026-10-14).

**Checked** (2026-10-14): a stored card is parsed at 20 places in 11 files; every one but two guards against a corrupt row, every writer writes only a clean list (`isStroke`, swept), and none of 28,395 stored cards is unreadable. Left as they are.

## Most worth consolidating (most visible to a member first)
1. Card totals and to-par (8 versions, two "played" tests).
2. Low-net pot's own net vs the board's net (money).
3. Position ordering with no shared comparator; prizes page sorts without countback.
4. Field of a cut round (6 versions).
5. `.complete` read without `matchIsOver`.
6. Course-handicap pipelines without 6.2b and the raw `event.defaultTeeId` (handicap-record.ts, handicaps.ts).
7. Inline confirmed-field query (~42) and left-the-field spellings.
8. "Any stroke" and "round official" spellings.
9. Typed handicap and rating readers.
10. Hand-assembled card chain and stored-card parsing (42 JSON.parse sites).
