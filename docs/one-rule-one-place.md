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
| 1 | What people type | handicaps, scores, money, dates read one way everywhere | done 2026-10-13 for every typed figure; reading a STORED card moved to step 5 |
| 2 | The field | who is in the tournament, and in this round | done 2026-10-14: the cut recorded and asked once; a player found by address one way; a round's cut settings read once; leaving the field asked once |
| 3 | The venue | which course, which card, which tees | done 2026-10-14: tees; a round's card built one way; the handicap record off the round's tees. One item measured unreachable and registered (a match countback's card) |
| 4 | Handicap | course handicap, playing handicap, strokes per hole | playing handicap done 2026-10-13; two side pipelines open |
| 5 | A card | gross, net, points, to par | not started |
| 6 | A round | finished or not, ranking, ties, a match result | not started |
| 7 | Across rounds | cut, flights, brackets, season table | not started |
| 8 | Money | pots, splits, who owes whom | not started |
| 9 | What screens say | two screens never give different answers | not started |

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
- **The field for the lowest par** (steps 2 and 4): `roundCourseHandicaps`
  requires `field`; `confirmedField(eventId)` supplies it. Nine readers, one
  field.
- **Which tees a player plays** (step 3): `teeIdFor` with the ladies' rung as a
  required argument; every reader of a round selects `FIELD_PLAYER`.
  `the-organizer-decides-the-tees.test.ts` allows one write of a player's tees in
  the whole app.
- **Deleted, with no callers**: `courseHandicapForPlayer` (a fourth course-handicap
  pipeline) and the tee matcher with its module.

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
- Playing handicap in a round: five readers pinned by every-reader-*.audit tests (deliberately unmerged).
- Deferred register: a singles net match is derived with no allowance while its screens apply one.

### 5 A card
- Per-hole formulas are single (`stablefordPointsForHole`, `modifiedStablefordForHole`, `holeStrokesReceived`). But the LOOP over a card is written six times: `computeStrokeCard` stroke.ts:115; `aggregateStroke` stroke-agg.ts:176; `cardPoints` card-points.ts:19; points-standings.ts:221-236; expenses.ts:1018-1027 with derived-games.ts:131 (low-net pot); team.ts:106-127, 265-276. They disagree on a played hole: `s == null` (stroke.ts:167; points-standings.ts:227) vs `s <= 0` (stroke-agg.ts:221; card-points.ts).
- To-par: EIGHT places, no shared function: stroke.ts:198; stroke-agg.ts:225 + tournament.ts:2208; stroke-countback.ts:249; team.ts:172; team.ts:285; PlayerCard.tsx:222-237; ScorecardTable.tsx:349-363, 569; HoleByHoleCard.tsx:271-281 (`== null`, so a 0 counts).

### 6 A round
- Finished: ~14 named predicates + ~30 inline. `resolveMatch(...).complete` read without `matchIsOver` (an empty [] card reads complete and halved): domain/standings.ts:108-120, 295; tournament.ts:2566, 3534; single-match.ts:76-79; tournament-result.ts:161-163; finish-order.ts:38; actions/tournament.ts:2356, 2962, 3382; ScoreEntryClient.tsx:274, 490.
- "Any stroke": `> 0` at cut-ready.ts:126; stroke-cut.ts:180; round-cards.ts:112 vs `!= null` at expenses.ts:513, 557; skins-pot.ts:291, 545; domain/skins-pot.ts:103; points-standings.ts:152; playing-history.ts:113.
- "Card full": scorecard-write.ts:97; actions/tournament.ts:2798; PlayerCard.tsx:208; PlayClient.tsx:549; tournament-switcher.ts:91; actions/play.ts:229.
- "Round official", two spellings: `closedAt != null` (leaderboard/page.tsx:233; me.ts:492, 634; expenses.ts:823, 1963; week-view.ts:484) vs `closedAt || event.status === "completed"` (expenses.ts:543, 1994; tournament-result.ts:263, 279, 355).
- Ranking: ~12 orderings, 4 numbering routines, no shared comparator. Individual stroke: tournament.ts:2271-2362 inline comparator + rank pass (twin `rankByCountback` has no callers but its test). Modified Stableford points-standings.ts:254 inline. Team teams.ts:555 (no countback). Prize pickers prizes/page.tsx:99-105 inline sort on raw gross/net, no countback. TWO exported functions both named `compareOnBasis` (stroke-countback.ts:256 relative to par; week-basis.ts:179 raw). Place numbers come from components via `placesByValue` with each caller's own rule.
- Match "confirmed or auto-confirmed": actions/tournament.ts:2556, 3628, 3581; match-filter.ts:39; ScoreEntryClient.tsx:2051; beside `effectiveScoreStatus`.

### 7 Across rounds
- See the cut-field six versions (layer 2) and cut rule four builders.
- Round label: `roundLabel`; index-derived outside the guard's pattern: week-view.ts:602, 619; availability.ts:289; cup.ts:91, 314 (two copies); regroup.ts:567; EntryModes.tsx:397.

### 8 Money
- `splitExactly` is the only divider; `settle`, `gameNets` single. Inline: MoneyClient.tsx:142 (preview label). Low-net pot computes its OWN net (expenses.ts:1018-1027 + derived-games.ts:131 `gross - Math.round(c.strokesReceived)`) rather than the board's.

### Dead twins of live rules
`rankByCountback`, `seasonPosition`, `isMatchStarted`. (`courseHandicapForPlayer` was the fourth and is deleted.)

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
