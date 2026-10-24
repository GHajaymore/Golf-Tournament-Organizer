# The foundation pass, 2026-10-23

Ajay, 2026-10-23: "I need the foundation / backbone of the app really strong and tested." The plan
since 13 October is nine layers, bottom up (`docs/one-rule-one-place.md`): each rule is ONE function
with required arguments, ONE test worked from the Rules by a route the code does not take, and ONE
sweep that refuses a second copy, with a control. Layers 1–7 were done by 14 October, 8 checked, 9
begun. This pass re-measured 1–7 on today's `main`, finished 8 and 9, and measured how strong the
tests are — by property tests and by mutation — rather than by how many there are.

## What was found

| # | Layer | What | Live? | Blast radius, measured read-only on the dev database |
|---|---|---|---|---|
| 1 | 9 (money on a screen) | The tournament report sized a side-game pot by the players whose net was not nought: a birdie pot of five at $5 with three players taking back exactly their stake read **"2 in: a $10 pot"**; a pot nobody won was **left out of the report**. | Yes — the report shipped in #924 | 0 of the 1 club side game on the dev database; latent for any report of such a pot in production |
| 2 | 6 (a match result) | `marginRefusal` accepted margins no match can finish on — "1&0", "6&3", "3 UP", "10&9" — and `marginToHoles` stored the card that margin builds, which reads as the result it really is: **"6&3" typed, "5&4" on the board**. Found by a property test. | Yes, at every door a result is typed | 0 of 5,749 result-shaped stored matches came from such a margin |
| 3 | 6 (a match is over) | Two writers asked `resolveMatch(holes).complete`, which an EMPTY card satisfies: the team match rebuilt from its sides' cards stamped a match nobody had played **scored, as a half** when its sides or its round's card were empty. Three readers asked it too. | Not reachable in stored data | 0 of 6,528 stored matches hold `[]` |

Each is fixed at the source with a test proven red on the old code (the report's two cases were run
against the old line and failed with "2 in: a $4.00 pot" and an absent pot).

## Re-measured: layers 1–7

Every sweep green on 12,640 unit tests; the 18,384 lines added since 14 October scanned for sixteen
shapes of a second copy. Folded: 5 direct `.complete` reads into `matchIsOver` (sweep added), 2
hand loops of "strokes received over the holes played" into `strokesReceivedOnHolesPlayed` (the
low-net pot leaves the allocation debt list). Read and left, with the reason: two countback
wordings that answer two questions, two inline `status: "confirmed"` in the one spelling, the
report's birdie highlight (counts birdies exactly, as a highlight should). The table is in
`docs/one-rule-one-place.md`.

## Layer 8, money: done

- **One place says when each game's amount may be reported**: `SIDE_GAME_PAYS` in
  `domain/money-layout.ts` — skins and every pot when the round is final; the Nassau and the match
  as each bet is decided (a finished front nine pays while the back is played); a contest when a
  winner is named. `gameNets` and `saveSideGame` read it.
- **One pot size**, `potCents` (six copies folded), beside the one split (`splitExactly`) and the
  one settle-up.
- **Every game worked by hand** (`side-games-by-their-own-rules.test.ts`): skins with carries and a
  tie on the last, net skins on the stroke-index hole, Nassau front/back/18 including a 9&8 closeout
  with the back still live and uneven sides, the match (3&2, a lead, a half, an empty card), birdie,
  eagle and twos pots, low gross and net (an unfinished card cannot win), a contest, shared costs
  with rounding and refunds, two payers, the settle-up. Presses are not offered by the app, so none
  is tested.
- **Sweeps** (`money-is-worked-out-in-one-place.test.ts`): no pot multiplied out or money divided
  by a head count outside the money module (one listed exemption, the entry form's "about" preview);
  one split and one settle; **only the club's own billing imports a payment provider, and nothing
  anywhere makes a transfer, payout, charge or payment link** — hard rule 7, now a test.

## Layer 9, what screens say

- `every-screen-gives-a-player-one-answer.audit.test.ts`: a player's place on the secretary's board,
  the public link, their own Today, and both copies of the tournament report; their money on their
  own Money screen, the standing everybody sees and the settle-up's handovers. Pinned to the order
  worked by hand; control: a reader ordered by name disagrees.
- `a-knockout-is-read-one-way.test.ts`: the draw's champion and finalist are 1st and 2nd in the
  finishing order the report, honours and season read; everybody else where the draw says they went
  out; no order before the final; progress equals results recorded — any field of 2–64, any order.
- Not done: extending `e2e/the-boards-agree.spec.ts` to the report pages in a browser. It seeds the
  shared club fixture, which another session's run would wipe; the data-level test covers the
  report's places, not their rendering.

## Property tests

`src/lib/domain/__tests__/properties-*.test.ts`, fast-check 4.10.2, fixed seed 20261023, each Rule
against `properties-reference.ts` (whole-number fractions, strokes handed out one at a time, a
match walked hole by hole): Course and Playing Handicap over every index +10.0 to 54.0 and every
slope; 6.2b after the allowance from the field's lowest par; strokes by stroke index on 18 and 9
holes, plus handicaps giving back from SI 18; a nine re-ranked; Stableford and Modified Stableford by
the scorer's table; a full card; a match, dormie and every margin both ways; net match strokes;
countback 9/6/3/1 and 6/3/1; a cut and its ties; a knockout of 1–256 in any order; splits,
settle-up, skins, net skins, Nassau, every derived pot, shared costs. One shrunk failure (finding 2)
is pinned as a regular test.

## Mutation scores

Stryker 10.0.0, 27 modules, 5,144 mutants. **Before**: the suite as it stood, before any test this
pass added (code refactors in, tests held out). **After**: the same modules with this pass's tests.

Before: 5,144 mutants, 2 h 42 min on this machine at concurrency 8. After: the twelve modules of
allocation, handicap, the match and money re-run incrementally (396 mutants re-tested, 57 min); the
other fifteen were not re-run, so their after figure is their before figure (the property tests of
the cut, countback and draw may well have raised them; the nightly run will say).

| Module | Before | After | Not caught, before → after |
|---|---|---|---|
| `domain/handicap.ts` | 75.50% | **83.94%** | 61 → 40 |
| `domain/stroke.ts` | 72.69% | **76.75%** | 74 → 63 |
| `domain/match.ts` | 77.85% | **80.51%** | 99 → 91 |
| `domain/money.ts` | 78.22% | 78.22% | 22 → 22 |
| `domain/money-layout.ts` | 86.67% | **100.00%** | 2 → 0 |
| `domain/derived-games.ts` | 68.87% | **73.58%** | 99 → 84 |
| `domain/nassau.ts` | 89.83% | 89.83% | 6 → 6 |
| `domain/skins.ts` | 87.10% | **91.94%** | 8 → 5 |
| `domain/skins-pot.ts` | 80.63% | **98.75%** | 31 → 2 |
| `domain/carry.ts` | 84.62% | 84.62% | 2 → 2 |
| `domain/expenses.ts` | 66.13% | **78.23%** | 84 → 54 |
| `domain/contests.ts` | 61.97% | **67.61%** | 27 → 23 |
| `domain/round-handicap.ts` | 69.41% | not re-run | 26 |
| `round-allowance.ts` | 87.59% | not re-run | 17 |
| `domain/stroke-agg.ts` | 91.04% | not re-run | 6 |
| `domain/card-points.ts` | 83.33% | not re-run | 4 |
| `domain/card-totals.ts` | 94.29% | not re-run | 2 |
| `domain/stroke-countback.ts` | 84.72% | not re-run | 11 |
| `domain/shared-position.ts` | 93.55% | not re-run | 2 |
| `domain/ranked-score.ts` | 91.25% | not re-run | 7 |
| `domain/standings.ts` | 68.47% | not re-run | 187 |
| `domain/cut.ts` | 81.54% | not re-run | 60 |
| `domain/cut-ready.ts` | 75.39% | not re-run | 47 |
| `domain/bracket.ts` | 84.28% | not re-run | 61 |
| `domain/bracket-flights.ts` | 82.40% | not re-run | 119 |
| `domain/draw.ts` | 78.71% | not re-run | 56 |
| `domain/date-words.ts` | 78.53% | not re-run | 35 |
| **All 27** | **77.55%** | **80.02%** | 1,155 → 1,032 |

`money.ts`'s 22 are, read one by one, equivalent (a debtor of nought has nothing to hand over
either way) or the ORDER of handovers in a tie — the settle-up still squares everybody, which the
property holds; its order is only pinned for the cases worked by hand. `stroke.ts`'s remaining 63
are mostly the dictation parser's word list ("double bogey", "albatross"); `handicap.ts`'s 40 are
mostly the words `explainHandicap` prints and the ladies'-tee chooser. `standings.ts` (187) and
`bracket-flights.ts` (119) are the largest counts left and the next to read.

The baseline the nightly ratchet holds is `mutation-baseline.json`: each module's score as measured
here — the after figure where a module was re-measured, the before figure otherwise.

### Survivors that mattered, and what killed them

- **Net match play** (`deriveNetHoles`): a net score made gross PLUS the strokes survived — the
  direction of the strokes was untested. Killed by a property against strokes handed out one at a
  time to the higher handicap.
- **Modified Stableford**: an albatross scored as worse than double bogey survived. Killed by the
  table.
- **Rule 6.2b without a field**: the lowest par taken as the HIGHEST survived; so did a par of
  nought counting. Killed.
- **Ledgers of two bets** (Nassau, contests, match bets): adding a second bet as a subtraction
  survived — every test had one bet. Killed.
- **Shared costs**: typed amounts a cent short, two payers, an unshared line. Killed.
- **The settle-up**: transfers that do not leave everybody square. Killed by the property.

### Left, and why

Equivalent mutants (a `>=` that only meets a strict case, a sort tie-break on unique keys, a `* sign`
made `/ sign` where the sign is ±1) and string mutants in explanations a screen prints are not
golf; the voice-transcript parser's word list (`stroke.ts`, `match.ts`) has no unit test for every
word, which is a gap in dictation, not in scoring. They are in the report
(`npm run mutation -- --report-only` after a run).

## What is left

- The three full rounds `qa:changed` asks for (core and shared), before merge.
- The fifteen modules not re-run, and the 1,032 survivors left — `standings.ts` and
  `bracket-flights.ts` first.
- The nightly workflow that runs `npm run mutation -- --ratchet` (another branch,
  `claude/testing-pipeline`).
- The report pages compared in a browser (above).
