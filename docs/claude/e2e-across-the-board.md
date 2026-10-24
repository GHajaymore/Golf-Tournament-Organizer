# End-to-end means across the board

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: writing or REPORTING a browser-test result; coverage. Index: `CLAUDE.md`.

## End-to-end means across the board

Ajay, 2026-10-10: "When you test, you test across the board — that's the e2e. It should cover
EVERYTHING IN THE APP." — functional, operational, security, every feature, onboarding, sign-in
and access control.

What prompted it. Eleven scripted tournaments, each a careful path at 120 players, passed three
times running and were reported to him as "three consecutive zero-defect rounds". An hour later
a sweep of options and inputs those scripts never used found about forty candidate defects: a
winner with a blank margin stored as a halved match, a back-nine round reset to the front nine,
a member made scratch by having a phone number corrected. Every one of those rounds was
honestly green. The claim was the defect: a pass count says how the paths walked behaved and
nothing about the paths nobody walked, and nothing was measuring those.

**So a browser-test result is never reported without its reach.** Two instruments exist for it:

- `e2e/coverage.ts` — every spec imports `test` from it, and every browser context records each
  server action called and each screen opened. `node scripts/e2e-coverage.mjs` holds that ledger
  against the BUILD's own lists and prints what was reached and, by name, what never was
  (`--reset` empties it before a run). Measured the day it was written: the whole standing suite,
  361 tests green, called **36 of 263 server actions**. Fourteen per cent.
- The app's controls, counted from the running app rather than from memory: as secretary,
  10,312 controls on screen across 267 screen-states of the seeded club — 117 distinct dropdowns,
  92 choice groups, 122 tick-boxes, 329 text boxes, 546 buttons.

**The layers of the suite**, each of which says in its own header what it cannot see:

- `e2e/everything.spec.ts` opens every console screen on every one of the seeded club's
  tournaments as the secretary, every player screen as a member, every public board signed out.
  The screen lists come from the filesystem and the menu itself.
- `e2e/every-control.spec.ts` (`E2E_EVERYTHING=1`) makes every choice every dropdown, choice
  group and tick-box offers, saves it the way the screen saves, reloads, and asks whether it was
  kept. It is the browser form of "what a screen OFFERS, the server ACCEPTS and the app READS
  must be one list" — see `docs/sweeps-2026-10-10.md`.

"A round" is the whole suite, and it is "clean" only with its reach stated beside it. A run
that did not exercise the list is a smoke test, whatever it is called.

**A SCREEN EVERY WALK OPENS AND NOBODY USES IS NOT A TESTED SCREEN.** Four areas were used in a
browser for the first time on 2026-10-13, each because the reach report named its actions as
never performed, and every one held something that was live in production:

    Season standings    a club could only ever have one season; a second showed the first's
                        rules; members who missed a cut were "entries with no roster record"
    the course editor   a refused card was refused above the whole form — none of the sentence
                        on the screen — so Add course looked like a button that did nothing
    Club settings       one tap on a radio changed somebody's role at the club
    the honours board   (nothing: the board was right, and the test's first draft was wrong
                        about which clubs keep one)

Three things to carry forward from them:

- **A REFUSAL IS SAID WHERE THE PRESS WAS.** Two of those were one fault: one line for every
  refusal at the top of a long screen, and the button at the bottom. So `e2e/coverage.ts` watches
  for it on every page of every test — words that look like a refusal, within four seconds of a
  press, with none of them on the screen — and `scripts/e2e-coverage.mjs` lists what it saw
  beside the reach (`R` lines). It is a list to READ: a "red" entry is a guess from the colour.
- **THE CLUBS THE SUITE WALKS DECIDE WHAT IT CAN SEE.** Both were on no plan, which is the free
  one, so every walk found the season table locked. The seeded club is a Birdie club now, with a
  season holding its finished championship; the e2e fixture's club is still on no plan, so the
  locked state is walked too. And that fixture club has no Commissioner, which no club made
  through the app can be: a spec that manages its staff seats the secretary first
  (`club-staff.spec.ts`), and the deferred register has what the ownerless state does.
- **A STEP THAT DID NOT RUN SAYS SO.** `club-course.spec.ts` first printed "NOT WALKED" for a card
  with a score on it — the fixture could not reach that — and then built the state for itself.
  A branch that skips in silence is a step counted as passed.

**Two habits this cost to learn, both the same night:**

- **Commit before any mutation check.** "Break it, watch the test go red, put it back" was done
  on uncommitted work and put back with `git checkout --`, which put back the fix as well. The
  rule further down says to restore with the Edit tool; the safer rule is that there is nothing
  uncommitted to lose. With the work committed, `git checkout -- <file>` is exactly right.
- **A finding from reading code becomes a test in the BROWSER, not only a fix.** The next round
  must be able to find it again without anybody remembering it.
