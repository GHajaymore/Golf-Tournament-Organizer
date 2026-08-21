# The scoring input model — decided 2026-08-21

Ajay's answers to the leaderboard question, which turned out to be a question
about something larger. Recorded before any of it was built, because the
reasoning is not recoverable from the code that implements it.

> **BUILT 2026-08-21.** Sections 1 to 3 and the whole of "Sequence" steps 1–3
> are implemented — see `docs/session-2026-08-21.md` for what was done, what
> opening the page caught that no test did, and the two questions below that are
> still open. The reasoning here is left exactly as written; it is the record of
> WHY, and the code is only the record of what.
>
> Still open, and neither answered by accident:
> - the `matchSettled` looseness flagged at the end of §1 — untouched;
> - **Sequence step 4, the leaderboard choice itself.** The tour-board polish it
>   refers to has since merged to `main` (`claude/tour-leaderboard`, e3cba39).
>   What has NOT been decided is the original question — points or a to-par
>   board, and whose choice. §1 dissolved the blocker (a match-play event now
>   carries real strokes, so the board would no longer be a column of zeros); it
>   did not make the choice.

## The principle

> **The default is a real card.** Every player records hole-by-hole GROSS
> scores, and the app derives the result from how the tournament is configured
> — net or gross, pairs, teams, and the tiebreakers. **Reduced input is the
> exception**, offered where the format genuinely does not produce a card: match
> play recording who won each hole, or only the match result.

Two things follow, and they are the point:

1. **One input, many results.** A gross card is the raw fact. Net, Stableford,
   four-ball, team aggregate and every tiebreaker are READINGS of it. The app
   should never ask for a derived number it can compute.
2. **A format may opt out, not opt in.** Reduced input is a named capability of
   a format, not a thing an organizer assembles by accident.

## Why this came up

The leaderboard question ("points, or a tour-style to-par board, and whose
choice?") could not be answered as asked. A match-play event carries **no
stroke data at all** — every match-play standing row hard-codes
`gross: 0, net: 0, toPar: 0, thru: 0` (`services/tournament.ts:905`), so a
to-par board there is a column of zeros. Offering the choice would hand an
empty board to exactly the club that asked for it.

The principle above dissolves that rather than working around it: if match-play
rounds carry real cards by default, the strokes exist.

**The plumbing is already half there.** Strokes for a match live in
`MatchScorecard`, keyed `(matchId, slot)`. What is missing is the JOIN — resolve
to `(playerId, stageId)` and reuse `parseStrokeCards` → `aggregateStroke`.
**Do not write a second copy of the allowance and countback rules.**

## The decisions

### 1. An incomplete match card shows as incomplete and is not ranked

Match play concedes holes (Rule 3.2b), and a match that ends 5&4 leaves four
holes unplayed. Those cards have real gaps, and **nothing may invent a number
for them.**

Rejected: ranking on holes played (a 5&4 winner on 14 holes against somebody's
18 looks comparable and is not — that is how a board and an engine come to
disagree about who advances), and filling gaps with net double bogey (right for
a handicap record, wrong on a results board: it puts a score on the sheet the
player never made).

Taken: the card shows the holes actually played, and the player is listed but
not ranked on the stroke board. This is the treatment stroke-play countback
already gives — an incomplete card never loses on countback — so it is the
convention this app already follows rather than a new one.

#### "Complete" means two different things, and they must not be merged

**Ajay's clarification, and the trap this whole section exists to avoid.** A
5&4 result is a FINISHED MATCH. It has a winner, and it settles the bracket, the
standings, the money and the round's progress. What is incomplete is the CARD.

So there are two questions and they have different answers for the same match:

| Question | 5&4 match | Decides |
| --- | --- | --- |
| Is the MATCH settled? | **Yes** | bracket, standings, round completion, payouts |
| Is the CARD complete? | **No** | whether it is ranked on a stroke/to-par board |

A single `complete` flag answering both is the defect shape this codebase keeps
paying for — `course` vs `club`, `tracksCash` vs `ledger`, `mode === "everyone"`
doing tracked-and-asked. Do not add one.

**The concrete hazard.** Once match play carries gross cards by default, it
becomes natural for something to test "does this card have eighteen holes?"
before treating a match or a round as done. **A 5&4 match would then never
complete**, the round would never close, and its pots would never pay out.

The existing code already has the right shape and must not regress:
`roundMoneyFor` computes `matchesDone` as *every match in the stage settled* and
feeds `roundMoneyIsFinal` with `roundComplete: matchesDone || event completed` —
explicitly because "match play returns no scorecards, so a round of it would
never look finished on holes alone and its pots would never be reported". That
comment was written for the case where there were NO cards; it holds just as
firmly when there are partial ones.

Cases that are settled with no complete card, or no card at all: a conceded
hole, a match conceded outright (Rule 3.2b), a walkover, and a forfeit — which
`forfeitMatch` already records for individuals and deliberately REFUSES for
teams rather than storing something nothing reads.

**One existing looseness to be aware of before building on it.**
`matchSettled` is `!!forfeitedBy || hasAnyHole(holes)` — ANY single hole marks
a match settled. That is deliberate for hole-by-hole match play, where the
result is written as holes are won and a match in progress is already partly
decided. But it means a round can read as complete while a match is genuinely
mid-play, and adding full gross cards makes that looser still, because a card
is now being filled in hole by hole for a reason unrelated to the result.
Whether "settled" should become "has a winner" is a real question — do not
answer it by accident while wiring the cards in.

### 2. Input mode is fixed by FORMAT, with an override

Each format declares its natural input; the organizer may override where it
makes sense. Closer to how `formats.ts` already declares `sideSize` and
`allowance` than to a free per-round setting, so the default is right more often
and setup asks fewer questions.

The override exists for the real case it serves: **a club that wants cards from
its match-play day for the handicap record.** Under WHS, match play scores are
acceptable for handicapping when a full card is returned, so this is not a
preference — it is the difference between a round counting and not.

## What this touches, and the warning that comes with it

This changes what gets RECORDED per format, so it reaches scoring, standings,
the cut, the bracket, the money and the tiebreakers.

`CLAUDE.md` is explicit about this class: the 2026-08-12 audit found ~80 defects
against 1400 passing tests, and almost none were in a function that was
individually wrong — they were in COMBINATIONS nobody had a test for. **Add the
cells to `src/lib/__tests__/matrix.test.ts`, not a bespoke test**, and sweep
field sizes from ONE.

Specific hazards already known:

- **Qualification and cut logic**, where the board and the engine have already
  disagreed about who advances.
- **Team formats**: a side's card is not a player's card, and `forfeitMatch`
  already refuses a team forfeit rather than storing one nothing reads.
- **The money.** `roundMoneyIsFinal` decides a round is settled when every hole
  that will be played has been returned OR every match is settled. Conceded
  holes mean a match round is complete with gaps, and a pot must not wait
  forever for holes nobody will play. See "complete means two different things"
  above — this is the first place the merged flag would bite.
- **A regression test is wanted for exactly this**: a match-play round whose
  matches are all settled, at least one of them early (5&4), must report the
  round complete, pay its pots, and advance the bracket — while the same
  players are unranked on the stroke board.
- **Assert against the Rules of Golf, not against current behaviour**, and put
  the citation in the comment. Two existing fixtures encoded matches that cannot
  happen — `H("AAAAABBBB")` is A five up with four to play, so the match ended
  5&4 and B cannot then win four holes.

## Sequence

1. The join: `MatchScorecard` → `(playerId, stageId)`, reusing the existing
   stroke aggregation. Matrix cells for match play with and without cards.
2. Incomplete-card handling on the board, per decision 1.
3. Format-declared input mode with an override, per decision 2.
4. Only then the leaderboard choice — the polish is already written and parked
   on `claude/tour-leaderboard`, and only affects events that have stroke data,
   so it can land before or after.

## Also decided 2026-08-21

- **The lifecycle button is "Start taking entries"**, not "Open registration".
  It moves a phase and publishes nothing, and three controls shared one word.
  Done — see `LifecycleBar.tsx`.
- **The registration deadline and field capacity stay on Tournament details.**
  They are set once when a tournament is defined, alongside dates and venue.
  The cross-links added by the simplification pass are the fix for the dead end
  on `/registration`; the controls do not move, and they are NOT duplicated —
  two editable copies of one setting is the defect class this codebase keeps
  paying for.
