# The combination sweep

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: scoring, draw, cut, bracket, handicap changes. Index: `CLAUDE.md`.

## Testing: the combination sweep

The 2026-08-12 audit found ~80 defects against a suite of 1400 passing tests.
Almost none were in a function that was individually wrong — they were in
COMBINATIONS nobody had a test for: a nine-hole round inside an eighteen-hole
tournament, a format on a stage type with no engine, a cut sized against a
field that no longer exists, a two-player event drawn into two flights of one.
Unit tests cannot find that class of bug, because every part behaves correctly
on its own.

So, for any change to scoring, draw, cut, bracket or handicap code:

1. **Add the cell to `src/lib/__tests__/matrix.test.ts`, not a bespoke test.**
   It enumerates format x stage type and runs brackets, cuts, flights and
   standings at 1, 2, 3, 4, 5, 6, 7, 8, 16 and 28 players, asserting
   INVARIANTS rather than features — ranks contiguous, no NaN, a cut never
   exceeds the field, a bracket winner is in its own match, no flight of one.
   A new format is then swept the day it is added.

2. **Field sizes start at ONE.** A one-player tournament, a two-player round
   robin and a three-player knockout are where the off-by-ones live, and the
   suite went no lower than a comfortable eight for a year.

3. **Assert against the Rules of Golf, not against current behaviour**, and put
   the citation in the comment. Several bugs survived because a test asserted
   what the code did. Two fixtures encoded matches that cannot happen —
   `H("AAAAABBBB")` is A five up with four to play, so the match ended 5&4 and
   B cannot then win four holes.

4. **Layout is swept from the filesystem** (`e2e/layout.spec.ts`), not a
   curated list. The hand-written list covered 14 of 22 routes; the eight it
   missed had no layout assertion at all. Do not reintroduce a hand list.

5. **A guard you must remember to call is a guard that will be forgotten.**
   `isManualFormat` was exactly that, and one of seven result paths forgot it —
   `services/me.ts` handed a player a rank, a "T2" and a to-par for a round the
   leaderboard refuses to score, so the screen contradicting the organizer was
   the one the player looks at.

   FIXED, and the shape of the fix is the point. It is checked at the SINK now:
   `standingRows` returns `[]` on its first line for a manual format, and
   `strokeRounds` keeps manual formats out of the cards that feed
   `strokeStandings` at all. So a caller written later is correct without
   knowing the rule exists — the tee sheet's "by position" grouping reads
   `strokeStandings` directly, has no guard of its own, and is safe because
   there is nothing there to rank. Checked again 2026-09-04.

   Prefer that shape. A rule enforced where the data is built cannot be
   forgotten by a caller; a rule documented in a comment will be.

6. **A green cell is not a checked cell — this file is UNEVEN.** Half of it
   asserts VALUES over a fixture built so a wrong answer looks different.
   `tee policy` computes the expected course handicap from the ratings, asserts
   both branches, and asserts the two tees differ so passing cannot be an
   accident of them being equal. `forfeits` halves every other match, so a
   credited hole can only have come from the concession. `round handicaps`
   asserts the exact number, source and editability. Those cells earn their
   green.

   The other half asserted only SHAPE, and on 2026-09-04 four blocks were each
   found to pass a materially wrong answer:

       season      ranked on a raw sum — a side won the league by missing weeks,
                   and the absentee was also the best scorer, so no assertion
                   could tell "top for the right reason" from "top for the wrong"
       standings   the whole leaderboard inverted, loser first — every match in
                   the fixture was halved, so nobody ever won anything
       brackets    seeds 1 and 2 drawn against each other in round one —
                   "every seed exactly once" is satisfied by 1,2,3,4,…
       cuts        the bottom of the field advancing instead of the top — the
                   COUNT is identical either way, and only the count was checked

   All four passed a 598-cell suite. Size, count, contiguity and membership are
   cheap to satisfy; being right is not.

   So before trusting a cell: **mutate the thing it covers and watch it go
   red.** If it stays green the fixture cannot express a wrong answer, and the
   cell is decoration however many sizes it runs at.

7. **AN ERROR THAT SHIFTS EVERY ROW BY THE SAME AMOUNT IS INVISIBLE TO THE EYE
   AND TO THE ORDERING TESTS**, which makes it more dangerous than one that
   scrambles the order. A wrong order produces an argument and an argument
   produces a bug report; eight plausible numbers in the right order produce
   nothing at all.

   Measured 2026-09-20, on the seeded club's first round played away from its
   event's course. Every side's to-par on the leaderboard was out by exactly
   four — a nine at Ardmore, par 32, scored against Braid Hollow's front nine,
   par 36 — and the RANKING was untouched, because a constant offset cannot
   reorder anything. Eight sides, correctly sorted, every number wrong, on the
   screen a club sends to its members.

   Nothing in eight thousand tests could see it: they assert shape, count and
   order, which a constant offset preserves perfectly. That is point 6 on the
   value axis rather than the shape axis.

   Two consequences worth acting on. **Net totals cannot see a stroke-index
   bug at all** — a side receives the same NUMBER of strokes whichever card is
   read, so net is gross minus a constant and is blind by construction; assert
   to-par, a Stableford point, a skin or a match hole instead. And when a
   number looks plausible on every row, check one row against the RULES rather
   than against the other rows: agreement between rows survives an error they
   all share. That cost twenty minutes on the day it was found — the week
   sheet and the leaderboard printed identical gross and net for the away
   round, which read as confirmation and was two readers wrong the same way.

   **A STABLEFORD POINT IS NOT A STABLEFORD TOTAL, and the sentence above is
   only right about the first.** A stroke is worth exactly +1 point wherever
   it falls, so moving every stroke on a card from the hardest holes to the
   easiest leaves the TOTAL untouched. Measured rather than reasoned: an
   eighteen-hole card, bogeys on the first four and pars after, scores 33
   either way. The total moves only where the points FLOOR at zero — put a 9
   on that hole and the stroke is wasted on it, and the same card scores 33
   against 34. So a Stableford total is nearly as blind as net, and for a
   different reason; the per-hole point, a skin, a match hole or to-par are
   the assertions that actually see allocation.

   **HOW MUCH OF THE SUITE CAN SEE IT, measured 2026-09-20** by flipping
   `holeStrokesReceived` to allocate onto the EASIEST holes — the same NUMBER
   of strokes, so every gross and net total is byte-identical. **18 of 8,151
   unit tests and 13 of 1,258 audit tests go red**, across the allocator,
   `cardForStage`, the entry screen's dots, the nine-hole wrap, team cards, a
   rendered screen, and — in the audit suite — net skins, the money, a match's
   own venue, the net import and a league that rotates venues. That is the
   coverage this section asks for, and it is worth re-running the same
   mutation after any change to stroke.ts rather than assuming it still holds.

   **AND CONSOLIDATION TAKES THE COMPARISON AWAY, which is the price of the
   fix this file otherwise recommends everywhere.** Eight callers resolving a
   card three different ways can be caught by diffing two screens; eight
   callers behind one resolver cannot, because they now agree by construction
   — and they agree whether the resolver is right or wrong. "One model per
   act" is still correct, and the note on `standingRows` returning `[]` at its
   own first line still holds. But a single reader must be pinned to the RULES
   rather than to its peers: after the team-card consolidation the only test
   that can still fail is one asserting to-par against the played course's
   actual par, because every screen will now agree on whatever it says.

   **THAT NUMBER IS FIXED, AND THE CAUSE WAS ONE ARGUMENT.** `cardForStage`
   takes which NINE and how many HOLES off the stage — which is what its own
   docstring is about — and leaves the COURSE to the caller. Five callers
   handed it the tournament's: both console boards, the public board and the
   league week sheet, carrying the skins and Modified Stableford boards with
   them, because those read the same local's stroke index. Every WRITE path
   already walked round then event through `courseForRound`, so the stored
   strokes were honest and only the reports were wrong.

   Three of the five had the right answer in scope the whole time.
   `state.strokeCourseFor(stageId)` is resolved per round and cached on
   `EventState`, and it is what the individual stroke board on those same
   screens reads — so one board disagreed with the other half of itself. The
   guard is `nobody builds a round's card straight from the tournament's own
   course` in `audit-guards.test.ts`, with a control; the VALUE is pinned in
   `board-scores-the-round-venue.audit.test.ts` against the played course's
   par, exactly as the paragraph above asks.

   `regroup.ts` stays event-level on purpose and is the one exemption: it
   resolves a single stroke index for a CHAIN of qualifying rounds, which has
   no one card to be resolved per round. `week-view.ts` documents the same
   exemption for its match tiebreaks.

8. **ASK WHICH TABLE THIS ROUND FILES ITS RESULT IN, BEFORE BELIEVING ANY
   COUNT.** There are FOUR, and on 2026-09-20 six separate readers were asking
   a true question of one that is empty for the round in front of them:

       Scorecard       a stroke round, one row per player
       TeamScorecard   anything `needsTeams` — one row per SIDE for a shared
                       ball, one per player for a four-ball
       Match           match play, AND a Nassau, whose stage type is "Stroke
                       Play Round" so a reader keyed on the type looks for
                       cards that never existed
       BracketWinner   a knockout. A bracket stage files no Scorecard and no
                       Match at all; its results are rows keyed by slot

   The symptom is always an absence reported as a fact — "Nothing returned for
   this round yet" over eight complete sides, "Matches complete 0/0 · 0% of
   round robin" over a knockout five ties through six, "this tournament hasn't
   been launched yet" said to people standing on the course. Measured, not
   argued: the seeded club's invitational holds 0 Scorecard rows against 16, 8
   and 8 TeamScorecard rows; its knockout holds 0 Match rows against 5
   BracketWinner rows.

   **And the denominator is the same question one level along.** `total` was
   the event's entry list, which is the wrong field for a team round (sides,
   not players) and for a CUT round (the survivors, not everyone who entered).
   A completed championship cut to 16 of 28 read "Cards in 16/28 · 57%
   submitted" with every card in.

   Two things follow. Fix it where the data is built — `boardProgress` carries
   the unit now, and there are FIVE of those rather than four:
   `cards | matches | sides | ties | manual`, the last being a round scored by
   hand, which files cards and has no board for them to count towards. So a
   screen cannot re-derive it from the event's format, which is how one
   absence came to have four readers.

   And when a screen shows nothing, check the table before the code:
   `grep` for every read of `prisma.scorecard` that decides EXISTENCE or
   PROGRESS rather than score found all four readers in twenty minutes, where
   walking screens had found one in an evening.

The multi-agent exploratory audit that produced all this is a RELEASE GATE or
post-feature pass, not a per-change step — it costs over a million tokens. Use
it to find unknown classes of bug; use the sweep above to stop known ones
coming back.
