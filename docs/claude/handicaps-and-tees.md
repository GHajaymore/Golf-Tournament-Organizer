# Handicaps and tees

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: allowance, course/playing handicap, par strokes, tee choice. Index: `CLAUDE.md`.

## Handicaps: an allowance is taken BEFORE rounding

Rules of Handicapping, 6.2a and Appendix C: a handicap allowance is "applied to the unrounded
Course Handicap as the final step", and the result is rounded once, a half upwards. For a format
with one team handicap (foursomes, greensomes, a scramble) the allowance is applied to each
partner's unrounded figure, the results combined, and the total rounded at the end.

Until 2026-10-13 the app rounded the course handicap, took the allowance of that, and rounded
again — **on purpose, with a comment saying so**, since the first handicap commit in August.
Measured over every index from 0.0 to 36.0 on four sets of tees:

```
                    95%            90%            85%
  a stroke out for  22-25%         22-23%         20-22%     of a field
```

in every net round with an allowance below 100, which is every individual net round and every
four-ball. The USGA's own example (8.6 and 10.3 off 71.0/125, par 71, at 85%) is 8 and 10; the
app said 9 and 9. The FAQ's worked example, headed as the calculation most golf software gets
wrong, printed 14 where the Rule gives 13.

**What to carry forward:**

- **The figures live in two forms and only one may meet an allowance.** `courseHandicap()` is the
  whole number a player is told; `courseHandicapExact()` is what it was rounded from. A field's
  handicaps are a `CourseHandicaps` — a `Map` of whole numbers, with `.exact(id)`. A round's
  answer is `resolveRoundHandicap(...).exact`, or `roundHandicapExactOf(row, whole, exact)`. A
  side member carries `handicapExact`, and `playing` where they play their own ball. **Never
  hand `playingHandicapFrom`, `allocatedStrokes` or `sidePlayingHandicap` a rounded figure**;
  `allowance-is-taken-of-the-exact-figure.test.ts` reads every caller, and refuses the
  arithmetic written out by hand anywhere but in `domain/handicap.ts`.
- **A whole number is right where a whole number is all there is**: a committee's own figure for
  the round (the Rule's exception covers it), and a round frozen before the exact figure was
  kept. `RoundHandicap.frozenExact` is written in the same statement as `frozen`. A reader that
  selects `frozen` and not `frozenExact` prices a frozen round a stroke differently from the
  board for one player in five.
- **`wholeStrokes()` is the only rounding.** 33.9 off an 85 slope is 25.5 exactly and arrives as
  25.499999999999996, which a bare `Math.round` calls 25.

**Why eleven thousand green tests could not see it, three ways:**

- **Nearly every fixture hands the engine a WHOLE-number handicap**, where rounding first and
  rounding last cannot differ. A golfer's index has a decimal place. That is an axis, and nothing
  walked it. `allowance-is-taken-of-the-exact-figure.test.ts` walks every tenth from plus 5.0 to
  54.0, on six sets of tees, at nine allowances, against the Rule worked in WHOLE NUMBERS
  (everything is an exact count of 113,000ths of a stroke) so that it shares neither formula nor
  floating point with the code.
- **The tests that did use an index worked out what to expect the way the app did.** Three
  database-backed tests had a helper `playing(tee) = playingHandicapFrom(roundedCourseHandicap, 95)`.
  A test that derives its expectation by the code's own method agrees with the code whether or
  not the code is right. Work the expectation from the RULE, by a route the code does not take.
- **"On purpose" in a comment is not a decision, and neither is a reason that sounds right.** The
  comment argued that the rounded figure is "a real, quoted number a player is told on the first
  tee". True, and beside the point: the Rule says what the allowance is taken of. When a comment
  defends a calculation, check the calculation against the SOURCE it is supposed to follow, not
  against the comment's own reasoning. It was found by writing a browser test that refused to
  take the board's word for the board.

And the guard that was already there: the score-entry screen had this arithmetic written out by
hand, in a file whose own test bans a second pipeline on that screen. The test banned a function
NAME (`playingHandicapFrom(`); the copy was spelled `Math.round((courseHandicap * pct) / 100)` and
walked past it for months. **Ban the shape, not the spelling** — the new sweep matches a handicap
multiplied and divided by a hundred, and has a control proving it recognises all three of the
lines it replaced.

A round frozen before that date keeps the strokes it was played off. See
`docs/deferred-register.md` for the neighbouring things seen and left alone.

**An individual net round has its allowance on its card, as a team round does** (2026-10-13;
Appendix C lets a field under thirty play at 100%). `individualAllowanceFor()` in
`round-allowance.ts` says which rounds have the line, `roundTakesAllowance()` is the same list
asked by `setStageAllowance` before it stores a figure — a gross medal, a singles match, skins
and a round scored by hand are refused — and `allowanceSaid()` is the one sentence both panels
print. The control was missing while the guide said it was there: **a sentence in the help that
names a control is a claim about a screen, and `guide-steps.test.ts` checks the buttons it names,
not the place it says they are.**

**AND THE FIGURE ITSELF DEPENDS ON THE ROUND, NOT ONLY ON THE FORMAT.** Appendix C gives a
four-ball 85% at stroke play and 90% in a match. The format table holds one number per format and
for Four-Ball held the match-play one, so a four-ball medal was offered 90% as "the recommended
allowance for this format" — and the seeded club's own four-ball round carried 85% "set by your
committee, in place of the usual 90%", typed over the app's figure by whoever wrote the fixture.
A fixture that has to correct the app is a finding nobody filed. `round-allowance.ts` is the one
reader (`recommendedAllowance(format, stage.type)`, `effectiveAllowance(format, override,
stage.type)`); the round's type is a required argument, so a caller cannot ask the format alone,
and `round-allowance.test.ts` refuses a file that reads `findFormat(x).allowance` for a round.
Best Ball's figure for a side of four is still not the table's — see the register.

**And the table is read against the SOURCE each time, not against the test that says it was.**
`handicap-allowances.test.ts` held the scrambles to being "a club convention, not a published
standard", with a paragraph explaining why that was the honest thing to say. Appendix C has carried
a scramble of four (25/20/15/10) and of two (35/15) for years, and the 2024 edition added a scramble
of three at 30/20/10 — where the app played 25/20/15, the four's shares with the last one dropped,
which is nobody's table. A test that asserts a fact about the Rules is as dated as the day somebody
last read the Rules; the header of that file says when.

## Tees of a higher par, and who chooses the tees

**A PLAYER ON TEES OF A HIGHER PAR IS GIVEN THE DIFFERENCE.** Rules of
Handicapping 6.2b: where the field plays sets of tees with different pars, in
stroke play or match play counted in strokes, a player on the higher par receives
the difference as extra strokes, AFTER the allowance and with no allowance taken
of it. None where a round is counted against par (Stableford).

The app gave none until 2026-10-13. Its own seeded medal is men off par 71 and
ladies off par 72: every lady was a stroke short, and `boards-by-the-rules.spec.ts`
— the test that works a board out "by the Rules" — agreed with the board about
all of them, because its author had read 6.2a and stopped. **A test worked from
the Rules is as complete as the Rules somebody read.** It was found by asking the
golf professional what the tests left out, not by any test.

- `roundPlayingHandicap(exact, allowance, parStrokes)` is what a round is priced
  with. The third argument is REQUIRED: thirteen places worked out a playing
  handicap, and each now says whether the strokes for the pars are in it.
  `playingHandicapFrom` is the arithmetic of an allowance and nothing else, and
  `tees-of-a-higher-par-get-their-strokes.test.ts` refuses it anywhere a round is
  priced.
- **The lowest par is the FIELD's, not the map's.** Nine readers build their
  handicaps from five different groups of players — everybody, one skins pot, one
  side, the two players of a match — and "the lowest par among the players I
  hold" is a different number for each. A pot of two ladies, both off 72, finds
  no difference and gives neither the stroke the board gives both; a skin is won
  hole by hole, so that is a different hole in a different pocket.
  `roundCourseHandicaps` REQUIRES `field`, and `confirmedField(eventId)` supplies
  it.
- `parStrokesApply(format, scoringBasis)` asks the BASIS as well as the format: a
  four-ball can be set to Stableford, and a stroke round can be stored the older
  way as points.
- A round that has frozen keeps what it froze (`RoundHandicap.frozenParStrokes`).
  A round frozen before that column existed reads nought and keeps its nets.

**THE ORGANIZER DECIDES THE TEES, AT THREE LEVELS** (Ajay, 2026-10-13): the
tournament's; a flight may override; the organizer may move one player. Where the
course has a ladies' set, a woman nobody has put elsewhere plays it — a DEFAULT
between the flight and the tournament, not a level. `teeIdFor` is the one
resolver and the ladies' rung is a required argument of it, which is how the
compiler found all five places that resolve a tee.

What prompted it: an ENTRANT could set their own tees through three doors — the
Preferred tee box on the public form, a member entering themselves, and adding a
member from the roster — each storing free text as the player's own set, where it
beat the flight's. Every test of tees was green over it, because every one put a
player on a set and asked whether it was honoured. **None asked who had put them
there.** When a rule is about who may decide, the test has to walk the doors,
not the outcome: `the-organizer-decides-the-tees.test.ts` finds every write to a
Player row in the app and allows exactly one to set tees.

- Nothing creates a player with a `teeId`. `setPlayerTee` is staff-only whatever
  the settings say. "Players choose their own tees" is retired; a tournament
  stored with it reads as `own`, which is how it was scored.
- Every reader of a round selects `FIELD_PLAYER`, which carries `gender`. Do not
  write the column list out again: a reader that left `gender` off would put a
  woman on the tournament's rating while the board had her on her own.
- What was left out on purpose is in `docs/deferred-register.md`.
