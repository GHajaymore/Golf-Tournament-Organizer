# testing-pipeline


## Moved from CLAUDE.md (20 Nov 2026): The testing pipeline

A round on GitHub is a push to `round/<name>-1` (`round.yml`: about thirty parts side by side).
Firefox will not start on this Windows machine at all — it is run there or not at all — and
its first run is where the dates above and `src/lib/leave-on-enter.ts` came from.

**SINCE 2026-10-23 THE PIPELINE IS THE TESTING PANEL'S** (`docs/testing-panel-2026-10-23.md`; the
manual is `docs/testing.md`). In one paragraph, so nobody acts on the old rules:

- **Rounds by tier**: tests, words and the front door need none; function in one area ONE —
  TARGETED (that area's specs + the always-on sweeps) when `scripts/qa/specs-by-area.mjs` places
  every file in one area; every function commit, targeted or full, then waits for the NIGHTLY; core
  ONE round that visits all six countries, and then it waits for the NIGHTLY before production;
  money or handicap arithmetic keeps THREE until property-based tests and the mutation ratchet are
  on main (`ARITHMETIC_KEEPS_THREE_ROUNDS` in `layers.mjs` is the switch). `npm run qa:changed`
  prints the exact branches; the Round workflow plans a pushed branch with the same function.
- **The nightly** (scheduled 02:17 UTC, but it has been starting 07:30–08:15 UTC; `nightly.yml`) runs every per-PR layer with all six countries, the
  console crawl in full, the Android tablet and the libraries' holes, and deploys what it cleared.
  **The weekly** (`weekly.yml`) runs Chrome, Edge and the front door's motion. A change's round
  runs the console crawl only when it touches input screens (`crawlNeeded`).
- **The machine is not the app**: a part the runner, the setup, the build download or the browser
  install stopped makes the verdict `INCOMPLETE — re-run`, never NOT CLEAN, and `round-waiter.yml`
  re-runs it. A crashed browser or a timed-out test is still a finding.
- **Zero retries stays**; `e2e/quarantine.json` (owner, reason, expiry) is the only way a red test
  does not count, and every entry is reported in every verdict.
- **`node scripts/qa/retro.mjs --write`** is the evidence for changing any of this.

**TWO SESSIONS ON ONE MACHINE SHARE ONE FIXTURE, AND A PLAYWRIGHT RUN IN EITHER WIPES THE
OTHER'S.** Every run seeds the e2e fixture at its start and tears it down at its end, under one
mark, in the one development database — whichever worktree it is started from. On 2026-10-13 a
second session's runs (nine of them between 01:25 and 02:08) deleted the rows this session's
specs were reading: two "caught" results in a break-the-app run were the fixture vanishing, not
the test working, and both read exactly like success. A wiped fixture produces FAILURES, so a
"caught" or a red result taken while another session was running is the suspect one. The rule
the two sessions settled, by message: before any Playwright run, one line to the other session
("fixture turn: starting, ~N min"), wait for "go", and say "done" when the teardown has finished.
Unit tests, a build into your own dist directory and a server on your own port collide with
nothing.

**A background round stopped with TaskStop is NOT stopped.** The shell dies and its children do
not: on 2026-10-13 a "stopped" round went on reseeding the club for hours under later trials,
which read as the app losing a sign-in mid-walk, and then started a build over the working
tree. After stopping one, list the processes (`Get-CimInstance Win32_Process` for `node.exe`
with `playwright`, `next` or `round.mjs` in the command line) and kill what is left.

