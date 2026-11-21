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

**Rules 2–6 are also enforced, not only written** (2026-11-04): `.claude/hooks/guard.mjs` runs before
every Bash and PowerShell command (`.claude/settings.json`) and refuses `git add -A`/`.`, any `git stash`,
a database reset, a push to `main`, a commit whose changes hold a real-looking email or phone number or a
local path (`C:\Users\<you>`), PowerShell writing a source file, `gh run watch`, a merge or `round/*` push from
any session but the one named in the untracked `.claude/main-session` (or from a subagent), a migration applied
to the shared dev database from anywhere but the main checkout (`--create-only` is fine), and — on the
Windows desktop only — builds, dev servers and Playwright.
A refusal names its rule. Text in quotes and heredocs is never read as a command. To change what it
allows, edit the script with `src/lib/__tests__/claude-guard-hook.test.ts`.

## Test fixtures

Use a throwaway organization and event, prefix every row with a mark (`zz-<purpose>`), invented
names, and `@example.invalid` addresses. Delete them in a `finally` — a fixture left in the
database is a fixture someone will later mistake for real.

A fixture that signs itself in signs `signedInNow(user.id)` (from `scripts/session-cookie.mjs`), never the bare user id: a cookie made the old way is refused and every screen answers 307. Long form: `docs/claude/sign-ins.md`.

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

A deadline is a DAY and a day belongs to a place: `Organization.timeZone`, `clubToday(zone)` / `clubDay(zone)` in `src/lib/domain/club-clock.ts`. The day helpers must be TOLD the day; never hand them `new Date()`, and `clubDay` is not an instant. `E2E_TZ` puts the browser and the seeded club in another zone. Long form: `docs/claude/club-clock.md`, `docs/claude/dates-and-figures.md`.

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
chrome also dresses `/faq`, `/privacy`, `/terms`. Pictures are unedited captures with an invented demo
club. Two sections are green on a phone as Ajay's TEST — never extend, restyle or remove them on
anybody's word but his; after go-live nothing changes without his preview. **Read `docs/claude/landing-page.md` before touching it.**

Stale help is tested (`player-help.test.ts`, `guide-steps.test.ts`, `guide-search.test.ts`); a flow that works differently under the same button names is not, and is yours.

## The secretary's home: what's next, and copy last event

The secretary's home (**What's next**) and **Copy last event** were approved by Ajay, 2026-10-24; the journeys are MEASURED and RATCHETED in `e2e/journey-budgets.ts`. Read `docs/claude/secretary-home.md` and `docs/claude/journeys.md` before touching them.

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

`npm run smoke` and `npm run smoke:all` are the CI smoke set; capture counts by grepping `Test Files|Tests `, never `| tail`; Playwright is the sixth part of the gate, and a branch is never called verified having skipped it. A red CI job your change cannot explain is one of five known faults. Detail: `docs/claude/smoke-and-gate-scripts.md`, `docs/claude/playwright-runs.md`, `docs/claude/ci-failure-signatures.md`.

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

Since 2026-10-23 the pipeline is the testing panel's (`docs/testing-panel-2026-10-23.md`; manual `docs/testing.md`): rounds by tier, the nightly and weekly, zero retries, `e2e/quarantine.json`. **Two sessions on one machine share one e2e fixture and a Playwright run in either wipes the other's:** send "fixture turn: starting" and wait for "go". A round stopped with TaskStop is not stopped; kill what is left. Read `docs/claude/testing-pipeline.md`.

- **The machine is not the app**: a part the runner, the setup, the build download or the browser
  install stopped makes the verdict `INCOMPLETE — re-run`, never NOT CLEAN, and `round-waiter.yml`
  re-runs it. A crashed browser or a timed-out test is still a finding.

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

## What gates a merge, and what gates a deploy

The `verify` check (ruleset "main must be green") gates a merge; `deploy.yml` gates a deploy (verify green, nightly cleared, no freeze) and never builds: Vercel does. Read WHICH JOB failed first: `verify` red is your change, `deploy` red on a green `verify` is the token, database or allowance. **A green PR is not a green commit:** tie the verdict to the head SHA (`--match-head-commit`). Only the main session merges. Long form, signatures and commands: `docs/claude/deploy-history.md`.

Since 2026-10-23 a green deploy job may also be a HOLD (a core change waiting for the nightly, or
the freeze): its summary starts "Deploy gate: hold" and says why. "Merged" is "live" only when the
gate said deploy, or when a GitHub deployment to `tourneyhq-production` names that commit or a
later one.

**SINCE 2026-10-23 THE STEPS ARE IN `deploy.yml`, BEHIND A GATE AND A FREEZE** (the testing
panel's item C). `ci.yml`'s `deploy` job calls it; so do the nightly round (after a clean
verdict), an hourly schedule and *Run workflow*. `scripts/qa/deploy-gate.mjs` deploys a commit
only when `verify` is green on it, every core commit since the last deploy is inside a clean
nightly round, and no club is in its FREEZE. **Ajay, 2026-11-06:** the freeze is OFF until 20 Nov 2026
(`FREEZE_RESUMES`, 20 Nov 00:00 in UTC+14); then, while sign-ins are held, only a PILOT club (one
where somebody on `SIGNIN_ALLOW_EMAILS` is staff) playing today freezes, never a weekend morning;
once live, a tournament on today at any club in its own time, or a weekend morning 05:00–14:00 in
any club's zone (`deployWindowFor`; old wording in `docs/claude/retired.md`). The freeze is asked of the APP
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

Ajay, 2026-10-13: shared pieces, not each screen's own logic. ONE function holds each rule (REQUIRED arguments), ONE test worked from the Rules by another route, ONE sweep that refuses a second copy. Inventory: `docs/one-rule-one-place.md`; long form: `docs/claude/one-rule-one-place-rationale.md`.

## Combination sweep

A change to scoring, draw, cut, bracket or handicap code adds a cell to `src/lib/__tests__/matrix.test.ts` (invariants, asserted against the Rules of Golf) and mutates it to watch it go red. Read `docs/claude/combination-sweep.md`.

## Migrations

`schema.prisma` splits the datasource: `url` pooled, `directUrl` direct; migrations need the direct URL.
Read the SQL a migration generated — fix the *schema* if an unrelated `DROP DEFAULT` rides along. **Name a new
migration folder `A001_…`, `A002_…` (`A0NN`) — never `100_`, never Prisma's timestamp** (a fresh database
replays folders in text order; `migrations-replay-in-the-order-written.test.ts` refuses anything else).
`prisma migrate dev --create-only` then rename the folder; apply with `prisma migrate deploy`; never a reset
(Hard rule 6). After a new model: `npx prisma generate` and RESTART the dev server (a running Next process
holds the old client: `prisma.yourNewModel` is `undefined`). `docs/claude/migrations.md`.

## Design

Two grounds, one set of tokens (`src/lib/themes.ts`); components read `--color-*` and never hard-code a colour; outdoor legibility is a requirement; grid/flex children need `min-width: 0`. Read `docs/claude/design.md`.

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
| starting or briefing any agent | `.claude/agents/STANDARDS.md` | the one standard every agent follows: no waiting on CI, other PRs' files, no real names, short hand-backs |
| any date, deadline, "today", time zone, E2E_TZ | `docs/claude/club-clock.md` | why the day is the club's; the helpers that must be told it |
| `src/app/page.tsx`, `src/lib/landing/*`, `/faq`, `/privacy`, `/terms` | `docs/claude/landing-page.md` | its stylesheet, its three rules, the green test, ownership |
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
| the logo, wordmark, brand colours, type, the QR mark, pictures, voice | `docs/brand-guide.md` | the one-page brand guide: files, sizes, grounds, contrast, what never to do |
| editing files via PowerShell, Git Bash or `node -e`; a refusing rebase | `docs/claude/shell-traps.md` | encoding corruption, CRLF, eaten backslashes |
| building a sweep/audit, walking screens, browser sessions | `docs/claude/sweeps-and-screen-walks.md` | controls, checks that pass on nothing, which session |
| scoring, draw, cut, bracket, handicap changes | `docs/claude/combination-sweep.md` | `matrix.test.ts`, invariants, constant-offset errors |
| the demo club, `isDemo`, `/demo`, the replay cron, anything that counts or messages clubs | `docs/claude/demo-club.md` | an invented club in production; every place it is left out, and the test for each |
| a journey spec, `e2e/journey*.ts`, a `JOURNEY-BREACH` in CI, a press or screen added to a set-up or player path | `docs/claude/journeys.md` | the seven journeys, what is counted, the ratchet both ways, when a ceiling may be raised |
| a lock scope, `refuseIfLocked`, the cup's teams, what money locks at completion | `docs/claude/lock-scopes.md` | which action asks which scope; the offer side locks at completion, the ledger never |
| the dashboard's What's next, copy last event | `docs/claude/secretary-home.md` | the home's jobs, `cloneEvent`, who may copy |
| rounds, the nightly, shared e2e fixture, a stopped round | `docs/claude/testing-pipeline.md` | the pipeline by tier; two sessions one fixture |
| history only | `docs/claude/retired.md` | Paragraphs superseded by a later ruling, kept verbatim with the reason |
