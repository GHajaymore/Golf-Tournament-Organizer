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

Added after the move (the list above is the original, kept whole by `claude-md-is-whole.test.ts`):

- `a-prize-transaction-reads-on-its-own-connection.test.ts` (2026-11-09) — while a prize action has
  an interactive transaction open, every read is on the transaction's client (`tx`), never the bare
  `prisma`. A read on the bare client from inside a transaction needs a SECOND pooled connection
  while the transaction holds the first, and it is outside the transaction's timeout: in the nightly
  of 2026-11-09 one such read stalled six seconds, the commit failed with P2028 "Transaction already
  closed", the action threw instead of refusing, and the Prizes screen became "This screen didn't
  load". The test's database is a fake that refuses the bare client the moment a transaction is
  open, so it cannot pass on a free pool. The same shape — `prisma.` inside `$transaction(async (tx)
  => …)`, or a helper called from there that uses it — is the thing to look for in any other action.
- `transactions-stay-on-their-own-connection.test.ts` (2026-11-09) — the class the test above found
  one of, closed for every file under `src`. It reads the source (comments stripped, braces matched)
  and finds every TRANSACTION SCOPE: the callback of each `$transaction(async (tx) => …)`, and every
  function handed a client as a parameter (`tx: Tx`, `tx: PrizeTx`, `Prisma.TransactionClient`,
  `db: Pick<typeof prisma, …>`). In each scope: the bare `prisma` is never named; everything awaited
  is on the scope's client or is a call handed that client; a returned call to one of the module's
  own functions is handed it too. The second and third rules are what close the INDIRECT shape — a
  helper the callback waits on is itself a scope, so a bare read two helpers deep is found at the
  helper and a helper that forgot to take the client is found at the call. It pins the count of
  transactions it finds, so a finder that stopped seeing them cannot pass by seeing nothing, and it
  plants each banned shape as a control. A legitimate await on something that is not the database
  goes in `KNOWN_OFF_CLIENT` with its reason; nothing is there. On the `main` of that morning it
  named exactly the nightly's defect, at the two calls that awaited `prizeWinnerNames` without `tx`.
- `the-tournament-is-asked-one-way.test.ts` (a WALL since state machine PR 9a, 2026-11-14; it was a
  ratchet over the screens until PR 5b emptied `KNOWN_STRAYS`) — "where is this tournament, what is
  next, what is locked" is asked of `tournamentStatus(facts)` and nothing else, over every non-test
  file in `src/app`, `src/components` AND `src/lib`, in four classes whose names live in ONE list,
  `src/lib/__tests__/retired-readers.ts` (the actions' and the timeline's sweeps read it too):
  **A** a deleted reader's name as an identifier anywhere in `src` (tests included), `e2e` or
  `scripts` — read by the TypeScript parser, so a comment or string naming it is history, while a
  declaration or `const { x } = await import(…)` is caught (two audit tests reached a dead twin that
  way). Since PR 9b (2026-11-15) class A holds the retired blanket unlock too — `configurationLocked`,
  `setConfigUnlocked` and the flag `configUnlocked` — named nowhere but the column's two files
  (`GONE_WITH_THE_COLUMN`, deleted with the column after launch); a test that needs a part open makes
  a committee correction (`correction-fixture.ts`, `e2e/committee-correction.ts`), and an old-flag row
  is written in SQL. `no-unlock-word.test.ts` keeps the word "unlock" off every screen, refusal, the
  guide and Help: "committee correction" is the one word; **B** the old modules' live rules (`statusMove`, `launchRefusal`, `PRE_LAUNCH_STATUSES` …)
  asked only by the machine and the old modules, one named exception; **C** the nine step-reading
  files decide nothing about the step; **D** a stored status compared by hand with "draft" or "live",
  three named files with exact counts, capped at three. Each class has a planted control.

**`required-is-what-launch-refuses.test.ts` (R1a): A "REQUIRED BEFORE LAUNCH" MARK IS WHAT LAUNCH REFUSES.**
`SETUP_FIELDS` (`src/lib/domain/setup-field.ts`) names each set-up field's holder in `tournamentStatus`, and `markOf`
is the one rule for its mark; `SetupField` draws only that. The test walks every `FAMILY_FIXTURES` family through
ten opening moves and asserts, both ways: every step and round need that `holds` is marked on some field; no field
is marked unless its holder holds (a two-round medal's undated Round 2, `holds: false`, is never required);
whenever a set-up tournament's launch is refused, some field is required. Where a screen implies "required" and
the machine does not hold, the test says so: list it for the Technical Director, never invent a holder.

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

## A new event says what it starts with (21 Nov 2026)

`every-event-create-says-its-defaults.test.ts` reads every `.event.create(` in `src/` (balanced
parentheses, through `readSource`, tests excluded) and refuses one whose body does not spread
`newEventDefaults()` (`src/lib/domain/event-defaults.ts`). The column default of `Event.bracketMode`
is the legacy "split"; a new row's value is `"single"`. The demo club writes both its tournaments
through `eventBase(`, which spreads `newEventDefaults()` itself, so the sweep accepts a create that
spreads `eventBase(` and a second test pins that `eventBase` does. A copy spreads the defaults BEFORE
the carried fields, so the source's own mode wins (`a-new-event-starts-single.audit.test.ts`).

## Who may ask which redesigned screens a request shows (22 Nov 2026)

`console-merges.test.ts` refuses any file under `src/` (tests excluded, through `readSource`) that calls
`mergesShown(` other than its definition, `src/app/(app)/layout.tsx` and
`src/lib/services/screens-shown.ts`. A page that varies by a redesigned screen calls
`screensShownFor(session)`, which reads the request's `x-search` and the viewer exactly as the layout
does, so "which screens does this request show" has one answer per page. The control plants a page
that calls it directly and expects the refusal.

## A server file never calls a client export, anywhere in src (G1, 23 Nov 2026)

`server-never-calls-a-client-export.test.ts` sweeps every `.ts` and `.tsx` under `src/` (tests excluded), not
only pages and components, and refuses a value import from a `"use client"` module unless the client module
DECLARES the name as a component (`function Name(` or `const Name = (`). A lowercase helper, a constant, or a
PascalCase object is refused. Controls: the R9a shape, a planted `src/lib/services/x.ts`, and a PascalCase
constant. A rule both sides need goes in a module with no directive (`scope-lock-rules.ts`).

## A `@redesign` block presses something that writes, and looks again (G1, 23 Nov 2026)

`redesign-specs-press.test.ts` reads every `test.describe("@redesign…")` in `e2e/*.spec.ts` through `readSource`
and refuses a block with no write press (`.click(`, `.fill(`, `.check(`, `.selectOption(`, `.press(`, not on a link or a
fold opener) or with no `reload()` / `goto(` after the first one. The blocks that fail today (all nine of R2's and
R9a's) are named in a dated `KNOWN_READ_ONLY` and placed with the QA Director; the list can only shrink. A floor on
the number of blocks found stops a broken reader passing on none. Controls: a planted read-only block, a press with no
look afterwards, a press only in a comment.

## One writer of a round's scoreInput, and the ring files (R4, 22 Nov 2026)

`one-writer-of-score-input.test.ts` refuses a second caller of `setStageScoreInput` anywhere in `src/` but `components/rounds/RoundScoreInput.tsx` (`writeScoreInput`), which the round card and the team round's select both call; the control plants a second writer. `the-timeline-reads-the-machine.test.ts` holds the redesigned Rounds & formats files (`RoundsScreen`, `BetweenRounds`, `ScoringTile`) to the ring wall: no `.needs` read, no literal denominator. A guard that pins what the Rounds screen draws reads `roundsScreenSource()` (`__tests__/rounds-source.ts`: the screen and `components/rounds/`), because its controls were lifted out of `StagesClient.tsx`.

## Moved from CLAUDE.md (20 Nov 2026): The guard hook

**Rules 2–6 are also enforced, not only written** (2026-11-04): `.claude/hooks/guard.mjs` runs before
every Bash and PowerShell command (`.claude/settings.json`) and refuses `git add -A`/`.`, any `git stash`,
a database reset, a push to `main`, a commit whose changes hold a real-looking email or phone number or a
local path (`C:\Users\<you>`), PowerShell writing a source file, `gh run watch`, a merge or `round/*` push from
any session but the one named in the untracked `.claude/main-session` (or from a subagent), a migration applied
to the shared dev database from anywhere but the main checkout (`--create-only` is fine), and — on the
Windows desktop only — builds, dev servers and Playwright.
A refusal names its rule. Text in quotes and heredocs is never read as a command. To change what it
allows, edit the script with `src/lib/__tests__/claude-guard-hook.test.ts`.

## Moved from CLAUDE.md (20 Nov 2026): How help goes stale

Three ways help goes stale are tested, so they cannot happen quietly: a new player screen with
no help topic, a button the help names that a screen no longer draws (`player-help.test.ts`,
`guide-steps.test.ts`), and a search result with nowhere to jump (`guide-search.test.ts`). The
fourth is not testable and is yours: a flow that works differently under the same button names.
The day this rule was written, the guide already held a sentence that morning's work had made
false — "Only Manual lets you … set tees per flight".

## Moved from CLAUDE.md (20 Nov 2026): What the tests enforce

Several test files exist to make a whole class of mistake impossible — extend them rather than working
around them; the list is in `docs/claude/what-the-tests-enforce.md` (`audit-idor`, `club-actions-check-the-role`,
`every-action-says-who-may-call-it`, `source-guard`, `round-number-source`, `themes`, `brand-consistency`, …).
**A test that searches source reads it through `readSource`** (`src/lib/__tests__/source.ts`, which strips
comments). **When a correct change makes a guard fail, read the guard before updating it** — pin the
GUARANTEE, not the expression. **Prove a new test can fail:** revert the fix (commit first), watch it go red,
put it back; when a mutation stays green suspect your theory of the defect before the harness. Enumerate a
string column's real values (`groupBy`) before narrowing a test on one. `TypeScript types are erased at
runtime` — a `"use server"` export is a public endpoint; validate payloads at the boundary (`score-payload.ts`).

