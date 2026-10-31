# What the tests enforce

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: adding or changing a guard test, or one going red on a correct change. Index: `CLAUDE.md`.

## What the tests enforce

The suite is not only about behaviour — several files exist to make a whole class of mistake
impossible. Extend these rather than working around them.

- `audit-idor.test.ts` — a row id an action is handed belongs to the caller: looked up with a
  scope key, or compared afterwards. That is ALL it asks. This line used to read "every server
  action checks authorization", which it does not: an action that takes no id is not its subject.
- `club-actions-check-the-role.test.ts` — an action that works on the caller's club asks their
  ROLE (`canEdit`), not only which club they are in. Added 2026-10-11 after deleting that check
  from one action left every guard green.
- `every-action-says-who-may-call-it.test.ts` — a staff action's gate comes BEFORE its first
  write, and an action with no staff gate is on a list that says who may call it (`WHO`). A new
  action cannot arrive ungated quietly. It proves a check is THERE, not that it is right.
- `the-directory-allowance-is-everyones.audit.test.ts` — every door to the live course directory
  draws on one hourly budget per person (`directoryBudget`), organizers included. The four
  directory actions are kept out of the every-action sweep because they spend that allowance —
  so they are the ones to read by hand whenever they change.
- `themes.test.ts` — every accent ramp and neutral ramp clears its contrast floor on both
  grounds, and stays monotonic.
- `brand-consistency.test.ts` — the logo is drawn once, at a size from `LOGO_SIZE`.
- `score-payload.ts` — scoring payloads are validated at the boundary. **TypeScript types are
  erased at runtime**; a `"use server"` export is a public HTTP endpoint and will be called with
  whatever the caller likes.
- `round-number-source.test.ts` — no screen derives a round number from a list position.
  `roundLabel` is the only count, and it does not count a cut as a round.
- `source-guard.test.ts` — **a test that searches source reads it through `readSource`**, from
  `src/lib/__tests__/source.ts`, which strips comments. Swept per file, so a new test file is
  covered the day it is added. See below for why.

**WHEN A CORRECT CHANGE MAKES AN EXISTING GUARD FAIL, READ THE GUARD BEFORE UPDATING IT.** A guard
that goes red on a change you have already proven right was asserting something false, and the
reflex — "update the test to match" — launders the old assertion into the new one. Three of these
in one day, 2026-09-21, none found by auditing tests and all three by changing code and reading
which cells went red:

```
audit-guards      required  roundTeeId(tees, event?.defaultTeeId)  in the net import
                  under a comment saying "required to use the ROUND's tees" — which is
                  what that expression was FIXING, not what it does. It is the
                  TOURNAMENT's set, so the guard held the door open in the name of
                  closing it
handicap-wiring   satisfied by a bare  courseHandicapMap(  in the team recompute, so it
                  could not tell the conversion being PRESENT from it being RIGHT
handicap-wiring   required  if (basis === "gross") return null;  in unratedWarning — and
                  that line was CORRECT. What it froze was the `basis: string` parameter,
                  which forced the caller to reduce a tournament's rounds to one answer
```

The third is the general case: **a source assertion freezes an interface, and an interface can be
the defect.** So pin the GUARANTEE, not the expression — the function a caller must go through and
the rungs it walks, never a spelling that could be either answer.

**AND ENUMERATE A STRING COLUMN'S REAL VALUES BEFORE NARROWING A TEST ON ONE.** Fixing the third
guard above, `!== "gross"` was replaced with the tidier `isNetBasis`, which is
`"net" || "both"`. `setScoringBasis` accepts FOUR values and the development database holds 2
`stableford` rounds, which are scored off a handicap — so the tidier spelling would have silenced
the warning for them: the same defect one value along, introduced while fixing it. `groupBy` on the
column is the check, not the schema comment, which said `gross | net | both` and was stale. Where an
unknown value should take the SAFE branch, prefer the negative test.

**Prove a new test can fail: revert the fix, watch it go red, put it back.** Six fixtures in one
pass could not fail — a card-venue test on gross match play (the card is never read), an
authorization test using a money mode that does not exist (every refusal passed on "Unknown money
setting"), a skins test with one player (nobody wins a skin either way). Each looked exactly like
a passing test of the fix, and each was counted as coverage.

**AND A MUTATION CAN STAY GREEN BECAUSE THE THEORY OF THE DEFECT WAS WRONG, which wears the same
clothes as a passing test.** A net-skins assertion said "Bob holds the pot and Ann does not"; the
mutation that priced the pot off the wrong club left it GREEN. Nothing was broken about the
instrument — Bob was on the higher index, so with identical gross cards he wins net skins off
EITHER club. What the venue changes is WHERE his extra strokes fall, because the gap between the two
moves with the slope: away he is alone on stroke index 8..15, off the host on 1..10. Re-pinned on
two holes, the mutation then failed with the received value `[1..10]` exactly.

So write the mutation before believing the assertion, and **when it stays green, suspect the theory
before the harness.** "What does this defect actually change?" is a different question from "is this
defect present", and a money test that answers only the second can be fully wired and prove nothing.

Mutate the WHOLE before-state, not half of it. Reverting one of two changed lines left the
headline case still passing: the rows were ordered wrongly but keyed the same, so they shared a
rank anyway. A mutation that models half the old code proves half as much as it appears to.

**And when the test reads SOURCE, the revert can stay green off your comment.** The prose above a
guard almost always names the guard, so `expect(src).toMatch(/checkRateLimit\(/)` goes on passing
after the call it pins has been deleted — the sentence describing the guard satisfies the
assertion instead. This is the one mutation failure that looks exactly like a mutation success:
the test is green, and you conclude the mutation was wrong rather than the test.

It happened twice on 2026-09-05, the second time in a test written by somebody who had been bitten
by the first that same afternoon. Hence `readSource`. Absence assertions are the safe direction
and need no help — a `not.toMatch` that a comment trips fails loudly.

The scale of it was measured rather than guessed, and the measurement is worth repeating whenever
this is in doubt: blank every comment in `src` and run the suite. In September 2026 that was 24,578
lines across 349 files and **4,268 of 4,268 still passed**, so eleven copies of a comment stripper
and 93 un-stripped reads had produced no live defect at all. Do that before believing a file count
means damage — the same discipline the course-card rules ask for, and for the same reason.

One trap in doing it: **blank the comments block-aware, and commit first.** A stripper that only
blanks lines starting with a marker leaves the body of any doc block written as plain indented
prose behind as dangling text, and three files stop parsing. And `git checkout -- src` afterwards
restores far more than the experiment — it discards every other uncommitted change in the
directory, which on 2026-09-05 cost a day's worth of conversions that had to be redone.
