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

**Rules 2–6 are also enforced, not only written:** `.claude/hooks/guard.mjs` runs before every Bash and PowerShell command and refuses them, naming the rule. What it refuses and how to change it: `docs/claude/what-the-tests-enforce.md`.

## Test fixtures

Use a throwaway organization and event, prefix every row with a mark (`zz-<purpose>`), invented
names, and `@example.invalid` addresses. Delete them in a `finally` — a fixture left in the
database is a fixture someone will later mistake for real.

A fixture that signs itself in signs `signedInNow(user.id)` (from `scripts/session-cookie.mjs`), never the bare user id: a cookie made the old way is refused and every screen answers 307. Long form: `docs/claude/sign-ins.md`.

## Sign-ins until launch: production is held

Ajay, 2026-10-17 and 2026-10-21: block sign-up and sign-in until he says launch. **Production holds itself** (`src/lib/sign-in-gate.ts`): only `OWNER_EMAILS` / `SIGNIN_ALLOW_EMAILS` may sign in or keep a session; everyone else sees the "opens soon" front door, and the held page says sign-ups "paused", never "closed". Every door asks `maySignInNow` / `signInsHeld` / `launchState`, so a new door must too. No session for an unproved address; every new password goes through `passwordRefusal`. Launch, the words and the signing-in rules: `docs/claude/sign-ins.md`.

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

**The landing page** is its own stylesheet, and two sections are green on a phone as Ajay's TEST: change nothing there on anybody's word but his. Read `docs/claude/landing-page.md` before touching it.

Stale help is tested (`player-help.test.ts`, `guide-steps.test.ts`, `guide-search.test.ts`); a flow that works differently under the same button names is not, and is yours.

## The secretary's home: what's next, and copy last event

The secretary's home (**What's next**) and **Copy last event** were approved by Ajay, 2026-10-24; the journeys are MEASURED and RATCHETED in `e2e/journey-budgets.ts`. Read `docs/claude/secretary-home.md` and `docs/claude/journeys.md` before touching them.

## End-to-end means across the board

Ajay, 2026-10-10: the e2e "should cover EVERYTHING IN THE APP". A browser-test result is never reported without its reach (`node scripts/e2e-coverage.mjs`), and a mutation check starts from a commit. Long form: `docs/claude/e2e-across-the-board.md`.

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

## What gates a merge, and what gates a deploy

The `verify` check (ruleset "main must be green") gates a merge; `deploy.yml` gates a deploy (verify green, nightly cleared, no freeze) and never builds: Vercel does. Read WHICH JOB failed first: `verify` red is your change, `deploy` red on a green `verify` is the token, database or allowance. **A green PR is not a green commit:** tie the verdict to the head SHA (`--match-head-commit`). Only the main session merges. Long form, signatures and commands: `docs/claude/deploy-history.md`.

## What the tests enforce

Guard tests make whole classes of mistake impossible: extend them rather than working around them, read a guard before updating it, read source through `readSource`, and prove a new test can fail (commit, revert, watch red, restore). The list: `docs/claude/what-the-tests-enforce.md`.

## Money: what may be reported while a round is live

**Final only, never live** (`money-layout.ts`): ask "can the amount still change", and enforce at the sink (`gameNets`). TourneyHQ calculates and records money; it never moves it. The app says "side game", never "bet". Read `docs/claude/money.md`.

## Golf rules that have bitten (read the long form before touching them)

Read the long form before touching: handicaps and tees (`docs/claude/handicaps-and-tees.md`: an allowance is taken of the EXACT course handicap and rounded once with `wholeStrokes()`; the organizer decides tees, `teeIdFor` is the one resolver), knockouts and leagues (`docs/claude/knockouts-and-leagues.md`: arranged is not happened), course cards (`docs/claude/course-cards.md`: `--revalidate` destroys cards).

## One rule, one place

Ajay, 2026-10-13: shared pieces, not each screen's own logic. ONE function holds each rule (REQUIRED arguments), ONE test worked from the Rules by another route, ONE sweep that refuses a second copy. Inventory: `docs/one-rule-one-place.md`; long form: `docs/claude/one-rule-one-place-rationale.md`.

## Combination sweep

A change to scoring, draw, cut, bracket or handicap code adds a cell to `src/lib/__tests__/matrix.test.ts` (invariants, asserted against the Rules of Golf) and mutates it to watch it go red. Read `docs/claude/combination-sweep.md`.

## Migrations

Name a new migration folder `A001_…`, `A002_…` (`A0NN`), never a timestamp; read the SQL it generated; never a reset (Hard rule 6); after a new model run `npx prisma generate` and restart the dev server. Read `docs/claude/migrations.md`.

## Design

Two grounds, one set of tokens (`src/lib/themes.ts`); components read `--color-*` and never hard-code a colour; outdoor legibility is a requirement; grid/flex children need `min-width: 0`. Read `docs/claude/design.md`.

## Shell

Windows. Both PowerShell and Git Bash are available and take different syntax — do not mix them
(a PowerShell here-string in bash silently becomes part of the string). Node needs
`PATH="/c/Program Files/nodejs:$PATH"` under Git Bash.

**Never rewrite a source file with PowerShell:** it adds a BOM and mojibakes em-dashes; use the Edit tool. The READ corrupts too, a `node -e` replace on CRLF does nothing quietly, and anything with a backslash goes through Write or Edit. More: `docs/claude/shell-traps.md`.

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
| the dashboard's What's next, copy last event | `docs/claude/secretary-home.md` | the home's jobs, `cloneEvent`, who may copy |
| rounds, the nightly, shared e2e fixture, a stopped round | `docs/claude/testing-pipeline.md` | the pipeline by tier; two sessions one fixture |
| history only | `docs/claude/retired.md` | Paragraphs superseded by a later ruling, kept verbatim with the reason |
