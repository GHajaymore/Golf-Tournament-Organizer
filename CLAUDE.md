# TourneyHQ

Golf tournament management. Next.js 15 (App Router) · React 19 · TypeScript · Prisma 6 · PostgreSQL.
Deployed on Vercel. Also packaged for iOS/Android via Capacitor and desktop via Electron.

**This is the CORE every session reads. The long lessons (incidents, measurements, rationale) live in
`docs/claude/`, one file per topic — the INDEX at the bottom says which to read first when your task
touches it. Nothing was deleted: `src/lib/__tests__/claude-md-is-whole.test.ts` fails if a paragraph of
the original goes missing.**

## Hard rules

These are not preferences. Breaking one has consequences that cannot be undone from here.

1. **Never modify, seed into, or test against an event holding real people.**
   Read it if you must; never write to it. The "2026 CDG Matchplay Championship" is the
   example this rule was written for and it is **still live in production** — it is simply
   not in the development database any more, which is `localhost/tourneyhq_dev` and holds
   demo data. Do not read that absence as the rule expiring: production is full of events
   carrying member names and addresses, and a seed or a test pointed at one cannot be undone
   from here.
2. **The GitHub repository is public.** No player PII — names, emails, phone numbers, scores
   tied to real people — may ever be committed. That includes fixtures, test data, screenshots
   and pasted logs.
3. **`main` auto-deploys to production via Vercel.** Do not push to it without saying so first.
4. **Commit with explicit paths.** Never `git add -A`; an untracked scratch file with real data
   is exactly how rule 2 gets broken.
5. **Never `git stash`** — this working tree is shared.
6. **Never `prisma migrate reset`** or any command that drops the development database.
   The stated reason used to be the CDG data, which is not in the dev database any more — so
   here is the reason that does not depend on what happens to be in it: a reset replays every
   migration from zero against an EMPTY database, which is exactly how a migration that only
   works on a populated one gets discovered in production rather than here. If Prisma demands
   a reset, fix the drift by hand instead (see Migrations).
7. **TourneyHQ calculates and records money. It never moves money.** Skins, payouts and prize
   splits are arithmetic and a record. No payment rails, no transfers.

## Test fixtures

Use a throwaway organization and event, prefix every row with a mark (`zz-<purpose>`), invented
names, and `@example.invalid` addresses. Delete them in a `finally` — a fixture left in the
database is a fixture someone will later mistake for real.

**A fixture that signs itself in signs `signedInNow(user.id)`**, from
`scripts/session-cookie.mjs` — never the bare user id. Since 2026-10-11 a session cookie
carries when it was issued (`src/lib/domain/session-token.ts`): the server holds a sign-in to
seven days itself, and a password reset ends every earlier one. A cookie made the old way is
refused, and a refused fixture does not fail loudly — every screen answers 307 to the sign-in
page, which a route walk reads as the app working. `session-token.test.ts` sweeps `e2e/` and
`scripts/` for the old spellings.

## Sign-ins until launch: production is held

Ajay, 2026-10-17 and 2026-10-21: block sign-up and sign-in until he says launch. `src/lib/sign-in-gate.ts`.
**Production holds itself:** only the owners on `OWNER_EMAILS` (and anybody on `SIGNIN_ALLOW_EMAILS`) may
sign in, set or reset a password, sign up, or keep a session; everybody else sees the "opens soon" front
door (sign-in only, `/play` for a player, every button to `/interest`). Previews, dev, CI and e2e are not
production and stay open. **To launch:** Go live on the Accounts card of `/owner` (`services/signins-switch.ts`),
or `SIGNINS=open` in Vercel — ONE press takes every held place live, Hold again holds them all; the places are
`LAUNCH_SURFACES` in `src/lib/go-live.ts` (= `docs/go-live-switch.md`), each screen takes `LaunchState` as a
REQUIRED argument, and once live the card sends the early-list codes on the owner's press (`services/early-list.ts`).
**Every door asks `maySignInNow` / `signInsHeld` / `launchState`** (`createSession`, `getSession`,
the sign-in actions, the public pages), so a new door must too. The held page's words are
`HELD_FRONT_DOOR` / `SIGNINS_CLOSED_NOTICE`: sign-ups "paused" (never "under development"), never the word
"closed" on screen, and the free plan's "Free for fields of up to 10" and "No card" stay down until launch.
It is held only while `OWNER_EMAILS` names somebody, so it can never lock everyone out.

**Signing in (2026-10-21):** no session for an address nobody has proved (`createSession` refuses a null
`emailVerifiedAt`; a fixture that signs in through it sets `emailVerifiedAt: new Date()`, a spec that signs
up or claims through the form calls `verifyByCode(page, email)` from `e2e/verify-by-code.ts`); every new
password goes through `passwordRefusal` (`services/password-breach.ts`); club staff on a browser not seen
before are sent a code (`KnownDevice`) — sign a STAFF fixture in with `signedInNow`, not the password form.
Long form: `docs/claude/sign-ins.md`.

## The club's clock: "today" is asked of the club, never of the server

A deadline is a DAY and a day belongs to a place. `Organization.timeZone` is an IANA name (or `""` = keep
the server's day). `src/lib/domain/club-clock.ts` is the rule: `clubToday(zone)`, `clubDay(zone)`; on the
server get the zone through `state.today` / `state.timeZone`, or `clubDayForEvent(eventId)`. The day helpers
(`todayIso`, `deadlinePassed`, `deadlineState`, `playerMayChange`, `registrationStatus`) must be TOLD the
day; never hand them `new Date()`. An INSTANT (timestamp, expiry, "3 minutes ago") is still the server's
clock; `clubDay(zone)` is NOT an instant — never compare it with a stored timestamp. **`E2E_TZ`**
(`E2E_TZ=Pacific/Auckland`) puts the browser AND the seeded club in another zone while the server stays
put — the only way a walk tells a server that asks the club from one that asks itself. Dates the app writes
go through `date-words.ts`; amounts typed in a club's language are read with `minorUnitsFrom` /
`decimalPoint` (see the index). Long form: `docs/claude/club-clock.md`, `docs/claude/dates-and-figures.md`.

## Help and docs travel with the change

Ajay, 2026-10-10: "keep a step when there is any change in the app to update the help section
(guide etc) or any documentations." He chose written help over an AI help bot, and written help
is only worth having while it is true. So a change to what somebody sees or does is not done
until, **in the same pull request**:

- **the organizer's guide** says it — `src/lib/guide-steps.ts`, shown at `/guide/steps` with a
  search box (`guide-search.ts`) and shipped as a PDF. **The PDF is rebuilt ONCE, before 19 Nov
  2026, stamped with its date, and then parked until the product stabilises** (Ajay and the panel,
  1 Nov): do not rebuild it per change. The Download PDF button stays. The one rebuild:
  `node scripts/build-guide-pdf.mjs` against a built server (see the script's header);
- **the player's Help** says it — `src/lib/player-help.ts`, shown at `/me/help`;
- any doc that describes it is corrected — this file, `docs/`.

Say which in the PR description: "Help/docs: updated …" or "Help/docs: nothing to change,
because …". And **ask Ajay** when a change might deserve a place on the landing page — a new
capability, a claim that has changed, a better screen to show. Do not decide silently that it
needs nothing.

**The landing page** (`src/app/page.tsx`, `src/lib/landing/home-styles.ts`) is its own stylesheet and its
chrome also dresses `/faq`, `/privacy`, `/terms`. Pictures are real captures of an invented demo club,
listed in ONE manifest (`src/lib/landing/screens.ts`) and re-shot by `npm run landing:capture`; a look
preset may sharpen them, never change what they say. One set of colours at every width: Ajay ended the
phone-only green test on 2026-11-01 ("the same color" everywhere; `e2e/landing-colours.spec.ts`). After
go-live nothing changes without his preview. **Read `docs/claude/landing-page.md` before touching it.**

Three ways help goes stale are tested, so they cannot happen quietly: a new player screen with
no help topic, a button the help names that a screen no longer draws (`player-help.test.ts`,
`guide-steps.test.ts`), and a search result with nowhere to jump (`guide-search.test.ts`). The
fourth is not testable and is yours: a flow that works differently under the same button names.
The day this rule was written, the guide already held a sentence that morning's work had made
false — "Only Manual lets you … set tees per flight".

## End-to-end means across the board

Ajay, 2026-10-10: the e2e "should cover EVERYTHING IN THE APP". **A browser-test result is never reported
without its reach**: `node scripts/e2e-coverage.mjs` (`--reset` empties the ledger before a run) prints what
was reached and, by name, what never was; the first measurement was 36 of 263 server actions. "A round" is
the whole suite and is "clean" only with its reach stated beside it. A screen every walk opens and nobody
uses is not a tested screen; a refusal is said where the press was; a step that did not run says so. A
finding from reading code becomes a browser test, not only a fix. **Commit before any mutation check** so
`git checkout -- <file>` is exactly right. Long form: `docs/claude/e2e-across-the-board.md`.

## Verification

Run before committing anything non-trivial:

```bash
npx tsc --noEmit && npx vitest run && npx next lint && NEXT_DIST_DIR=.next-ci npx next build
```

The command above runs the DEFAULT config, which excludes `*.audit.test.ts` — those need a real
database and live in `vitest.audit.config.ts`. Anything whose behaviour is only provable against
real rows (handicap resolution, authorization, money) is asserted there, so a change to one of
those areas is not verified until you have also run:

```bash
npx vitest run --config vitest.audit.config.ts
```

Use `NEXT_DIST_DIR=.next-ci` for builds while a dev server is running; sharing `.next` between
them corrupts it.

- **`npm run smoke`** GETs every route against a running server (default `http://localhost:3000`; set
  `SMOKE_BASE_URL`) and fails on a 5xx. In a worktree check `preview_list`'s `cwd` first: `preview_start`
  reuses a dev server running from the MAIN checkout and every route then passes against code you did not write.
- **`npm run smoke:all`** is CI's whole "Smoke-test every route" step locally (SEVEN scripts: `smoke-routes`,
  `verify-round-controls`, `verify-drafting`, `verify-week-view`, `verify-lifecycle`, `verify-player-states`,
  `verify-public-boards`) against a BUILT server in `.next-ci` on 3102; `-- --no-build` reuses the build. Run
  it when you change copy, move a control, or touch a screen that reads a list that can be empty — five of
  the scripts pin user-facing strings. `FAIL 0` / `fetch failed` means NO SERVER (the dev server restarts
  itself at a memory threshold), not a broken route: restart and run the set again.
- **Capture the counts, not the tail.** `| tail` swallows an exit code and a failing vitest still prints
  `Duration`. Grep `Test Files|Tests ` and record the command's own status:
  `npx vitest run 2>&1 | grep -E "Test Files|Tests " >> "$O"; echo "unit exit=${PIPESTATUS[0]}" >> "$O"`.
  A check whose failure looks like its success is not a check.
- **Playwright is the sixth part of the gate:** `AUTH_SECRET=local-e2e-secret npx playwright test` (needs a
  database it may write — the development one only). Never say a branch or `main` is verified having skipped
  it. It builds into `.next-e2e` (no clash with the dev server), but **`reuseExistingServer` is `!CI`**: a
  killed run leaves `next start` listening on 3101 and the next run tests the OLD build. Before believing a
  local e2e result: `ls -la --time-style=full-iso .next-e2e/BUILD_ID` (older than your last edit = stale) and
  `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3101/` (200 before you start = stale). Cleanup:
  kill the listener on 3101 (`powershell -c "Get-NetTCPConnection -LocalPort 3101 -State Listen | %{ Stop-Process -Id \$_.OwningProcess -Force }"`)
  and `rm -rf .next-e2e`. Failures that all take the same time, cascade across unrelated files and carry no
  expected/received value mean the server under them died.
- **Reading a change in the browser: bust the URL** (`?bust=1`) or assert against `fetch(url, { cache: "no-store" })`.
- **WebKit** (`E2E_ENGINE=webkit`) needs the server started with `E2E_PLAIN_HTTP=1`; await `landingSettled(page)`
  before measuring or pressing on the front door. More in `docs/claude/e2e-traps.md`.
- **A red CI job your change cannot explain** is one of five known faults — Chromium `SEGV_MAPERR` (signal 11,
  desktop), `Could not find the module … in the React Client Manifest`, `next/font`, the `offline.spec.ts`
  card-chooser click, or React #418. Open the log, name which, and `gh run rerun <id> --failed`; do NOT add
  `retries` and do not edit application code on the strength of one. After the hydration backport a
  `[hydration #418]` line is a REAL mismatch — fix the element it names. See `docs/claude/ci-failure-signatures.md`,
  `docs/claude/offline-chooser-flake.md`, `docs/claude/hydration-418.md`.

## The testing framework: `docs/testing.md`

Ajay, 2026-10-13: "you should be building these permanent test script which covers all aspects
of the app and use it whenever we make any change in the app. Keep it updated whenever we add
any functionality." That is `scripts/qa/` and `docs/testing.md`, and three habits come with it:

- **`npm run qa:changed` first, on every finished change.** It reads the files touched and says which tier
  of testing the change needs (tests, words and the front door need none; function in one area ONE round;
  core ONE round that visits all six countries and then waits for the nightly; money or handicap arithmetic
  keeps THREE) and prints the exact branches. Quote it in the pull request.
- **A change is not done until the tests know about it.** A new action needs a spec that DOES it as the person
  who would; a new format needs a scenario; a new language needs a line in the date table. `docs/testing.md`
  has the table of what to add for what, and `qa-framework.test.ts` holds the framework's lists to the files on disk.
- **"Is everything covered?" is answered with the measured figure** (`node scripts/e2e-coverage.mjs`), never
  with the size of the suite.

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
- **The nightly** (scheduled 02:00 UTC, but it has been starting 07:30–08:15 UTC; `nightly.yml`) runs every per-PR layer with all six countries, the
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

## What gates a merge, and what gates a deploy

`ci.yml` is the only workflow that runs on its own — every push and every PR. It does the
command above plus the smoke pass and Playwright.

**What stops a bad merge** is a RULESET named "main must be green", not classic branch
protection. Branch protection is OFF, so `/repos/.../branches/main/protection` returns 404
and tells you nothing; ask `/rules/branches/main` instead. It requires the `verify` check
and blocks deletion and force-push on `main`. `strict` is off, so a branch need not be
rebased onto `main` to merge.

**What stops a bad deploy**, since 2026-09-04: the `deploy` job in `ci.yml`, which
`needs: verify` and runs only on a push to `main`. Nothing reaches production until the
whole gate is green. Vercel's own Git deploy for `main` is off — `vercel.json` sets
`git.deploymentEnabled.main = false` — so that job is the only route in. Preview deploys
on `claude/*` branches are untouched, since a PR's reviewer needs one. **`round/*`, `breaks/*`
and `dependabot/*` build no preview** (2026-10-30): a round builds its own server on the runner
and never opened the preview, and 170 round branches had filled Function Storage past the free
plan's 10 GB, the point at which Vercel may refuse a production deploy.

**SINCE 2026-10-23 THE STEPS ARE IN `deploy.yml`, BEHIND A GATE AND A FREEZE** (the testing
panel's item C). `ci.yml`'s `deploy` job calls it; so do the nightly round (after a clean
verdict), an hourly schedule and *Run workflow*. `scripts/qa/deploy-gate.mjs` deploys a commit
only when `verify` is green on it, every core commit since the last deploy is inside a clean
nightly round, and no club is in its FREEZE — a tournament on today in the club's own time, or a
weekend morning 05:00–14:00 in any club's zone. The freeze is asked of the APP
(`/api/deploy-window`, bearer `DEPLOY_WINDOW_TOKEN`, answering only `{frozen, reason}`), because
this runner must never hold production's database credentials (below); unreachable means not
frozen, said in the summary. A HOLD IS GREEN — the gate working — and the hourly run ships it
later. *Override freeze* is for emergencies and overrides only the freeze. What production holds
is recorded as a GitHub deployment to `tourneyhq-production`. The job's check is now named
`Deploy to production / Deploy to production`, so read it with `endswith`, as below.

**The deploy job does not build.** It uploads the source and Vercel builds it; `vercel-build` runs
`prisma migrate deploy` against PRODUCTION, so never build on the runner or ship `--prebuilt` (it would put
production database credentials on GitHub). **A red `deploy` on a green `verify` is not the code:** the
`VERCEL_TOKEN` (check `vercel whoami` FIRST), the production database unreachable, the 100-deployments-a-day
allowance (every push counts, not every merge — batch work into fewer, larger PRs and push each branch once),
or CANCELLED after a long `Completing…` (the deploy may be Ready — check the Vercel dashboard for that SHA
before re-running). `android-release.yml` / `ios-testflight.yml` are scaffolding with no secrets. Long
form and the signatures: `docs/claude/deploy-history.md`.

So read WHICH JOB failed before reading anything else. `verify` red is your change; `deploy` red
on a green `verify` is the token, the database, or the allowance, and the message names which.
A BUILD that fails inside `next/font` is none of them and is not yours either.
Nothing shipped unverified either way — `deploy` has `needs: verify` — but a commit CAN sit
undeployed until the next merge, so do not read "merged" as "live" without checking the run:

```bash
gh run view <run-id> --json jobs -q '.jobs[] | select(.name|endswith("Deploy to production")) | .conclusion'
```

Since 2026-10-23 a green deploy job may also be a HOLD (a core change waiting for the nightly, or
the freeze): its summary starts "Deploy gate: hold" and says why. "Merged" is "live" only when the
gate said deploy, or when a GitHub deployment to `tourneyhq-production` names that commit or a
later one.

**AND A GREEN PR IS NOT A GREEN COMMIT.** `gh pr checks <n>` answers "is this
PR green". On 2026-09-20 an auto-merge read it seconds after a second commit
was pushed to the branch, counted the PREVIOUS head's sixteen green checks,
merged, and `main` took the first commit only. The PR closed, the work looked
shipped, and nothing in the output said otherwise — it was found because a file
on the new `main` was missing a function it should have had.

Tie the verdict to a SHA at both ends:

```bash
head=$(gh pr view "$PR" --json headRefOid -q .headRefOid)
gh api "repos/$REPO/commits/$head/check-runs" -q '.check_runs[] | .status + ":" + (.conclusion // "pending")'
gh pr merge "$PR" --squash --match-head-commit "$head"
```

Also: `--delete-branch` from a worktree fails with `'main' is already used by worktree` on a merge that
SUCCEEDED — take the verdict from `gh pr view --json state` and confirm with `git show origin/main:<file>`.
Merge one at a time and let each `verify` finish when the history must mean something (a batch merge
leaves a wall of `cancelled`); ask for a commit's run with `gh run list --branch main --json headSha,conclusion`.
`main` auto-deploys (Hard rule 3).

## What the tests enforce

Several test files exist to make a whole class of mistake impossible — extend them rather than working
around them; the list is in `docs/claude/what-the-tests-enforce.md` (`audit-idor`, `club-actions-check-the-role`,
`every-action-says-who-may-call-it`, `source-guard`, `round-number-source`, `themes`, `brand-consistency`, …).
**A test that searches source reads it through `readSource`** (`src/lib/__tests__/source.ts`, which strips
comments). **When a correct change makes a guard fail, read the guard before updating it** — pin the
GUARANTEE, not the expression. **Prove a new test can fail:** revert the fix (commit first), watch it go red,
put it back; when a mutation stays green suspect your theory of the defect before the harness. Enumerate a
string column's real values (`groupBy`) before narrowing a test on one. `TypeScript types are erased at
runtime` — a `"use server"` export is a public endpoint; validate payloads at the boundary (`score-payload.ts`).

## Money: what may be reported while a round is live

`money-layout.ts` opens with the rule — **final only, never live.** Ask "can the amount still change", not
"has the event happened": a birdie pot, low gross and low net change as cards come in; a Nassau's completed
segments are paid live. Enforce at the SINK (`gameNets`, as `standingRows` returns `[]` for a manual
format) so a caller written later cannot forget. `matchSettled` is too loose to release money. A player may
still see their EXPOSURE (`stakeFor`). **TourneyHQ calculates and records money; it never moves it** (Hard
rule 7).

**The app says "side game", never "bet"** (Ajay, 2026-10-21: "side games will resonate with our
moto of no gambling"). On every screen, in the guide and in the player's Help, not only on the
public pages that ads land on. `public-pages-never-say-bet.test.ts` sweeps the whole of `src` for
the phrases a sentence makes of the word; `bet` as a code NAME (`bet.name`, `renameBet`) is fine.

## Golf rules that have bitten (read the long form before touching them)

- **Handicaps** (`docs/claude/handicaps-and-tees.md`): an allowance is taken of the EXACT course handicap and
  rounded ONCE (`wholeStrokes()`) — never hand `playingHandicapFrom`, `allocatedStrokes` or
  `sidePlayingHandicap` a rounded figure (`courseHandicapExact`, `resolveRoundHandicap(...).exact`). A player on
  tees of a higher par is given the difference (`roundPlayingHandicap(exact, allowance, parStrokes)` — the third
  argument is required; none for Stableford). The right allowance depends on the round's type, not only the
  format (`recommendedAllowance(format, stage.type)` in `round-allowance.ts`). Work an expectation from the
  Rules by a route the code does not take, with decimal indexes.
- **Tees**: the organizer decides, at three levels (tournament, flight, one player); `teeIdFor` is the one
  resolver; nothing creates a player with a `teeId`; every reader of a round selects `FIELD_PLAYER`.
- **Knockouts and leagues** (`docs/claude/knockouts-and-leagues.md`): past the first round there is no bye; a
  tie not yet played is "TBD"; flights are separate knockouts (`bracketDraws()` is the one answer to "which
  draws"; test with THREE). What has been ARRANGED has not HAPPENED: `matchIsOver(holes)`, never
  `resolveMatch(holes).complete`; count what there SHOULD be, not the rows that exist; a lookup by
  `id: { in: [...] }` has no order.
- **Course cards** (`docs/claude/course-cards.md`): `--revalidate` DESTROYS every card it refuses — judge the
  catalogue with a read-only script that calls `cardRefusal`; yardage is never a reason to discard a card.

## One rule, one place

Ajay, 2026-10-13: "make sure the underlying pieces/modules are in line and built as shareable vs every
screen/function/round using different logic or their own way." Two screens answering one question
differently is the class a screen test cannot see. `docs/one-rule-one-place.md` is the inventory. For each
rule: (1) ONE function holds it and takes what it needs as REQUIRED arguments, so the compiler lists every
caller the day the rule grows; (2) ONE test worked from the Rules of Golf by a route the code does not take,
on the axis the fixtures missed; (3) ONE sweep that refuses a second copy, with a control proving it can see
one. A single reader must be pinned to the RULES (readers that agree by construction agree whether or not
they are right); a dead twin of a live rule is a second copy waiting to be used. Ban the shape, not the
spelling. Long form: `docs/claude/one-rule-one-place-rationale.md`.

## Combination sweep

For any change to scoring, draw, cut, bracket or handicap code add the cell to
`src/lib/__tests__/matrix.test.ts` (format x stage type x field sizes starting at ONE; invariants, not
features), assert against the Rules of Golf with the citation, and mutate what a cell covers to watch it
go red. A constant offset on every row is invisible to ordering tests: check one row against the Rules.
Ask which table (Scorecard, TeamScorecard, Match, BracketWinner) a round files its result in before
believing any count. `docs/claude/combination-sweep.md`.

## Migrations

`schema.prisma` splits the datasource: `url` pooled, `directUrl` direct; migrations need the direct URL.
Read the SQL a migration generated — fix the *schema* if an unrelated `DROP DEFAULT` rides along. **Name a new
migration folder `A001_…`, `A002_…` (`A0NN`) — never `100_`, never Prisma's timestamp** (a fresh database
replays folders in text order; `migrations-replay-in-the-order-written.test.ts` refuses anything else).
`prisma migrate dev --create-only` then rename the folder; apply with `prisma migrate deploy`; never a reset
(Hard rule 6). After a new model: `npx prisma generate` and RESTART the dev server (a running Next process
holds the old client: `prisma.yourNewModel` is `undefined`). `docs/claude/migrations.md`.

## Design

Two grounds, one set of tokens (`DARK_GROUND`, `LIGHT_GROUND` in `src/lib/themes.ts`); components read
`--color-*` properties and never hard-code a colour. One club theme drives the console, the public board
AND the player app (`themeCss`). Outdoor legibility is a requirement (`SUNLIGHT_RATIO` 7:1 on dark, 4.5 on
light). Grid/flex children need `min-width: 0`; anything wide gets its own `overflow-x: auto` wrapper.
`docs/claude/design.md`.

## Shell

Windows. Both PowerShell and Git Bash are available and take different syntax — do not mix them
(a PowerShell here-string in bash silently becomes part of the string). Node needs
`PATH="/c/Program Files/nodejs:$PATH"` under Git Bash.

**Never rewrite a source file with PowerShell.** `Set-Content -Encoding utf8` adds a BOM and
re-encodes every em-dash and curly quote as mojibake. It corrupted `stage-types.ts` once and
seven page files later the same day, both times invisibly — the code still compiled and the
tests still passed. Use the Edit tool, however many files it takes. The tell is
`git diff --stat`: a one-line change showing seventy.

Also, each learned the hard way (`docs/claude/shell-traps.md`): **the READ corrupts, not the write**
(`Get-Content -Raw` decodes ANSI) — PowerShell may READ a source file and never write one back; use `git` to
restore (`git checkout -- <file>`, after committing). **A `node -e` string replace on a CRLF checkout does
nothing and says so quietly** — print `before !== after` and `grep -c` before and after, or use Edit.
**Anything containing a backslash goes through the Write or Edit tool**, never a heredoc or `node -e`
(`\b` becomes a backspace; prefer `indexOf` / `includes` / `split`). A rebase that refuses over a file with no
diff: `git add --renormalize prisma/migrations/migration_lock.toml` (never `git stash`). A sweep that finds
nothing needs a CONTROL; a script that fetches an authenticated screen asserts status 200 before reading the
body (a 307 is a success that looks like the app working); know which session the browser holds before
believing a screen is wrong about you (`docs/claude/sweeps-and-screen-walks.md`).

## Index: if your task touches X, read this first

| If your task touches… | Read first | What is in it |
| --- | --- | --- |
| sign-in, sign-up, sessions, passwords, codes, known devices, launching accounts | `docs/claude/sign-ins.md` | the hold in full; proved address, leaked passwords, new-device codes |
| any date, deadline, "today", time zone, E2E_TZ | `docs/claude/club-clock.md` | why the day is the club's; the helpers that must be told it |
| `src/app/page.tsx`, `src/lib/landing/*`, `/faq`, `/privacy`, `/terms` | `docs/claude/landing-page.md` | its stylesheet, the screens manifest and `landing:capture`, one colour at every width, ownership |
| writing or REPORTING a browser-test result; coverage | `docs/claude/e2e-across-the-board.md` | why a pass count is not a claim; reach instruments; mutation habits |
| writing or debugging a spec | `docs/claude/e2e-traps.md` | service worker, typing before load, slow saves, fonts, front door, WebKit |
| `npm run smoke`, `smoke:all`, `verify-*`, a gate that pipes an exit code | `docs/claude/smoke-and-gate-scripts.md` | what each CI smoke script asserts and why |
| running the e2e suite on this machine | `docs/claude/playwright-runs.md` | stale builds, dead-server cascades, dev-server restarts |
| a red CI job your diff cannot explain | `docs/claude/ci-failure-signatures.md` | Chromium SEGV, Client Manifest, next/font |
| `offline.spec.ts`, the card conflict chooser | `docs/claude/offline-chooser-flake.md` | the click that never lands; its two signatures |
| a hydration error, `[hydration #418]`, relative times in components | `docs/claude/hydration-418.md` | the slow-delivery fault and the React backport |
| writing a date/time/amount, or reading money a person typed | `docs/claude/dates-and-figures.md` | `date-words`, Node-version trap, `minorUnitsFrom` |
| a deploy failed or is missing; batch merges | `docs/claude/deploy-history.md` | every way deploy has failed; audit trail of batches |
| adding or changing a guard test, or one going red on a correct change | `docs/claude/what-the-tests-enforce.md` | the guard tests, `readSource`, mutation discipline |
| side games, pots, skins, Nassau, money shown mid-round | `docs/claude/money.md` | final-only, the sink rule, "side game" never "bet" |
| brackets, byes, flights, club leagues, week sheets | `docs/claude/knockouts-and-leagues.md` | no byes past round one; arranged is not happened |
| allowance, course/playing handicap, par strokes, tee choice | `docs/claude/handicaps-and-tees.md` | allowance before rounding; higher-par tees; who picks tees |
| adding or consolidating a rule several screens share | `docs/claude/one-rule-one-place-rationale.md` | the three-part shape and its cautions |
| card validation, the catalogue, `--revalidate` | `docs/claude/course-cards.md` | measure a guard before shipping it |
| any Prisma schema change | `docs/claude/migrations.md` | datasource split, `A0NN` naming, stale-client trap |
| themes, colour tokens, contrast, overflow | `docs/claude/design.md` | grounds, one club theme, outdoor legibility |
| editing files via PowerShell, Git Bash or `node -e`; a refusing rebase | `docs/claude/shell-traps.md` | encoding corruption, CRLF, eaten backslashes |
| building a sweep/audit, walking screens, browser sessions | `docs/claude/sweeps-and-screen-walks.md` | controls, checks that pass on nothing, which session |
| scoring, draw, cut, bracket, handicap changes | `docs/claude/combination-sweep.md` | `matrix.test.ts`, invariants, constant-offset errors |
| the demo club, `isDemo`, `/demo`, the replay cron, anything that counts or messages clubs | `docs/claude/demo-club.md` | an invented club in production; every place it is left out, and the test for each |
| history only | `docs/claude/retired.md` | Paragraphs superseded by a later ruling, kept verbatim with the reason |
