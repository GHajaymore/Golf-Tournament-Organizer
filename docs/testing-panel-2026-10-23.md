# The testing pipeline — the panel's decision, 2026-10-23

Ajay asked for it: "if we need to change anything this is the time". Four hats sat on it — the QA
manager, the test architect, the golf professional and the tournament director — over two rounds of
debate. This is what they decided and what was built (pull request `claude/testing-pipeline`).
`docs/testing.md` is the manual; this page is the record of the decision and its reasons.

## What prompted it, measured

From `node scripts/qa/retro.mjs` on the eight rounds before the decision: **a round took 88–128
minutes of wall clock and about 550 runner-minutes**, every change to core paid that three times, and
on 2026-10-23 three rounds in a row read "failure" because Ubuntu's mirror served the browsers'
packages at 40 KB/s — every part died installing a browser, before a single test, and each verdict
said NOT CLEAN in the words it uses for a wrong score. All eight rounds in the window were clean on
the app; none of their layers recorded an assertion failure.

So the cost was real and the third copy of a core round was finding flakiness, not faults. The panel
did not cut WHAT is tested. It changed WHEN, and it stopped the machine being reported as the app.

## A. Rounds by tier

| Tier | Before it merges | Before production |
|---|---|---|
| Tests and tooling · Words and documents · The front door | No round — CI only | — |
| Function in one area | ONE round (`round/<name>-1`, three countries) | `verify`, outside the freeze |
| Core and shared | ONE round that visits **all six** countries | a clean **nightly** round on that commit or a later one containing it |
| Money or handicap arithmetic (core) | **THREE** rounds, all six countries — transitional | the nightly, as core |

- *Golf professional:* a wrong stroke or a wrong pound is invisible on most fixtures (CLAUDE.md, "an
  error that shifts every row by the same amount"). Until property-based tests over every handicap
  and stake and a nightly mutation ratchet exist (being built on `claude/foundation-pass`), money and
  handicap arithmetic keeps its three rounds. **The switch:** `ARITHMETIC_KEEPS_THREE_ROUNDS` and the
  file list `ARITHMETIC` in `scripts/qa/layers.mjs`; set it to false in the pull request that puts
  those instruments on main, and record it here.
- *Test architect:* "all six countries" is one round with three more parts (`countries: "all"`), not
  three repeats of everything else — `partsFor(1, { schedule: "pr", countries: "all" })` is 41 parts
  against 37 for three countries.
- `npm run qa:changed` prints the exact branches to push, the countries, whether the crawl is in and
  which file asked for it, and whether the nightly gates production. The Round workflow plans a
  pushed branch with the same function (`roundPlan`), so what it prints is what runs.

## B. What runs when

| | Layers |
|---|---|
| A change's round (`pr`) | the whole suite; somewhere else; the American club; abroad; iPhone, Safari, iPad; Firefox; the eleven tournaments |
| **Nightly**, 02:00 UTC on main (`nightly.yml`) | every `pr` layer with **all six** countries; the console crawl **in full**; the Android tablet; the libraries' published holes and the quarantine list's dates |
| **Weekly**, Sunday 03:00 UTC (`weekly.yml`) | Chrome as installed; Edge as installed; the front door with its animation on |

- *QA manager:* the dependency check left the per-PR round. A hole published overnight is about the
  calendar, not the change, and a registry that could not be asked stopped rounds that had tested
  everything else.
- **The console crawl stays in a change's round** for anything touching what a secretary types or
  picks — a console screen or action, a component or rule named for entry, handicaps, tees, scores,
  courses, members, flights, formats, allowances, draws and the like (`crawlNeeded`), and every core
  change. Otherwise it is left out, and the nightly runs it every night. A round without the crawl
  does not hold its reach to `reach-baseline.json` (the list was measured with the crawl).

## C. Deploy gating, and the freeze

`deploy.yml` is now the only way into production, called by `ci.yml` after `verify`, by the nightly
after a clean round, every hour (to pick up a held deploy), and by hand. It deploys a commit only if:

1. `verify` is green on it;
2. every "Core and shared" commit since the last deploy is contained in a clean nightly round;
3. no club is in its **freeze** — a tournament on today in the club's own time (a round dated today,
   or dates of at most a week that take in today), or Saturday and Sunday 05:00–14:00 in any club's
   zone.

*Tournament director:* the freeze is about the secretary running a shotgun and 144 players saving
after every hole; a deploy at 09:00 on a Saturday lands on all of them at once.

**The runner never gets production database credentials** — the reason CLAUDE.md gives for the
deploy job not building. So the app answers the freeze itself: `GET /api/deploy-window`
(`src/app/api/deploy-window/route.ts`, rule in `src/lib/domain/deploy-window.ts`), authorised by a
bearer token, returns only `{ frozen, reason }` — counts and zone names, never a club or a person.
If the app cannot be asked, the deploy is not frozen and the summary says so. A held deploy is
**green** (the gate working); the hourly run or the nightly ships it later.

**Emergencies:** *Run workflow* on **Deploy** with *override freeze*. That overrides the freeze only.
A core fix that cannot wait for 02:00 runs the **Nightly round** by hand (about forty minutes) and
deploys when it is clean.

What production holds is recorded as a GitHub deployment to the `tourneyhq-production` environment
after every deploy; before the first record, the gate finds the last deploy by its "Deploy" step.

## D. Infrastructure is "did not run", never red

A verdict is now one of **CLEAN**, **NOT CLEAN** (the app or a test said something was wrong),
**CLEAN, BUT NOT ALL OVER** (left out on purpose), or **INCOMPLETE — re-run**: no finding, but parts
the MACHINE never ran — the runner lost, checking out/installing/migrating failed, the build not
downloaded, the browser not installed, a registry not reached (`scripts/qa/infra.mjs`). A crashed
browser, a timed-out test and a server that would not start are NOT on the list: each has been the
app before. Each part writes `job-status.json`; the waiter (`round-waiter.yml`) re-runs an
INCOMPLETE round's failed jobs, up to the third attempt. NOT CLEAN is never re-run.

**Playwright's container image was measured and not adopted.** A container job reaches its Postgres
service by the service's name, not localhost; `scripts/seed-club.mjs` refuses any host that is not
localhost, on purpose; GitHub refuses `--network` in a job container's options. Getting round that
means a TCP forwarder in every part or loosening the guard — neither clean. The image also lacks the
installed Chrome and Edge, `lsof` (which `round.mjs` stops its server with) and `sudo`, and runs
Firefox as root. Instead the shared packages job stays, and it can no longer fail a round
(`continue-on-error` and a twenty-minute step limit — the same change as #923).

## E. Flakiness: zero retries, and a quarantine

Zero retries stays (`playwright.config.ts`). `e2e/quarantine.json` lists tests known to be wrong
about THEMSELVES — spec, test, owner, reason, an expiry at most 30 days out. A round still runs every
one and reports it in a section of its own; its failure does not count. An entry past its date
quarantines nothing and fails the nightly's check (`scripts/qa/quarantine.mjs`). It starts empty.

## F. New checks

1. **`e2e/secretary-back-after-a-week.spec.ts`** — a secretary whose last sign-in was eight days ago,
   at 07:xx in the club's own zone (the spec finds a zone where it is seven o'clock now and puts the
   club and both browsers there), is turned to the front door on the old device with the destination
   kept, signs in with the password and lands on it; on a new device, signs in and lands in today's
   tournament's console with a session issued that minute. Password path: the organizer new-device
   code is ruled for after email verification and is not on main.
2. **Production canary** (`canary.yml`), hourly, read-only: the front door, `/faq`, `/play`, a page
   that must be 404, and one public board (secret `CANARY_BOARD_URL`). A failed run is the alert:
   GitHub emails the person who last changed the workflow's schedule, when their notification
   settings send Actions emails ("Only notify for failed workflows").
3. **The shotgun load test** (`scripts/load/`): 144 players on a nine-hole round by round code, each
   saving after every hole every 10–20 s, and 300 phones reloading the public board. Run with k6
   against a PREVIEW with a production-sized database (`scripts/load/README.md`); never production.
   Proven locally at a quarter of the scale with `k6-lite.mjs` — figures below.

## And: the retro

`node scripts/qa/retro.mjs --write` reads the last N rounds back from GitHub — wall-clock and
runner-minutes, each failure classed app / test / infrastructure, assertion failures per layer —
plus time-to-merge per pull request and the mutation score when one is kept, and writes
`docs/testing-retro.md`. Layers that found nothing in the window are listed as candidates to move to
the nightly or the weekly: candidates for this panel, not decisions.

## What Ajay has to add (names only)

| Secret | Where | For |
|---|---|---|
| `DEPLOY_WINDOW_TOKEN` | GitHub Actions secrets **and** Vercel production environment variables, the same value | the deploy freeze |
| `CANARY_BOARD_URL` | GitHub Actions secrets | the canary's public board |

`VERCEL_TOKEN` is unchanged. Until `DEPLOY_WINDOW_TOKEN` is in both places, deploys go out unfrozen and
each deploy's summary says so.

## Local load figures (2026-10-23)

A quarter of the shotgun — **36 players and 75 phones**, the default timing (10–20 s between saves,
15–30 s between board reloads, players arriving over 30 s) — against a production build on this
Windows laptop (`next start`, the local Postgres), driven by `k6-lite.mjs` on the same machine:

| | median | p(95) | max | n |
|---|---|---|---|---|
| saving a card (`savePlayCard`) | 79 ms | 173 ms | 544 ms | 324, all saved |
| claiming a place by round code | 78 ms | 1,713 ms | 3,167 ms | 36, all in |
| the public board (`/live/<token>`) | 86 ms | 407 ms | 1,306 ms | 880 |
| every request | 82 ms | 328 ms | | 1,268, none failed |

Every threshold held; all 36 cards were in the database with nine scores each, and the field was
taken away afterwards. How to read it:

- **It proves the script and the two actions work under a crowd**, and it measures a laptop. The
  slow tail of the claims is the first thirty seconds, when 111 worker threads start on the same
  machine as the server: two earlier runs, before the viewers' first look was spread over their
  first reload interval, put the board's p(95) at 2.4 s and the claims' at 2.0–2.6 s — every phone
  asking in the same second, which is the runner, not a Saturday.
- **It says nothing yet about Vercel**: a function cold-starting against a pooled database across a
  region, at four times this crowd. That number comes only from the preview run in
  `scripts/load/README.md`, and is owed before the first real shotgun.
