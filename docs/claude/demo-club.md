# The demo club

> Written 2026-10-24, when Ajay approved the panel's design. Read this when your task touches: `Organization.isDemo`, `/demo`, `/api/cron/demo-replay`, `services/demo-club.ts`, the owner console's Demo club card, or anything that counts clubs, freezes deploys, limits or bills a club, or sends a message. Index: `CLAUDE.md`.

## What it is

An INVENTED club, live in production, that anybody can watch from the front door's **See a demo club's day**:
Quillstone Golf Club (searched: not a real club; not the seeded development club; not a test tournament),
twenty-four invented players, no addresses at all, on the club clock of `America/New_York`. Two tournaments:

- **Quillstone Autumn Championship**, finished: two rounds four and three days ago, every card written
  through `writeScorecard`, approved, the rounds closed and the tournament completed, so its board is Final,
  its event page is in the "afterwards" state and its final report is whole.
- **Quillstone Club Medal**, playing now: drawn in threes from 08:00, half an hour apart; a hole every
  fourteen minutes by the club's clock (`holesDueAt`). It starts again on the first replay after the club's
  midnight, and the championship moves with it so it is always earlier in the week.

Every demo page — the board, the clubhouse screen (`?screen=clubhouse`), the event page, the report and
`/demo` itself — carries **Demo club, invented players** (`DemoClubLabel`, `data-demo-club`).

## Who writes it

- **The owner's button** on `/owner` ("Demo club: create / refresh", `refreshDemoClub` in
  `actions/owner.ts`) calls `buildDemoClub`. Ajay presses it in production. Nothing else there can, and
  no session, script or runner of ours ever touches production.
- **The replay** (`/api/cron/demo-replay`, `advanceDemoReplay`) writes the medal's cards up to the club's
  present minute, through `writeScorecard` — the console's and the round code's own writer. It is called
  every quarter hour by `.github/workflows/demo-replay.yml` (bearer `DEMO_REPLAY_TOKEN`; the runner holds
  that token and nothing else) and once a day at the club's early morning by Vercel Cron (`vercel.json`,
  bearer `CRON_SECRET`). The project's plan runs Vercel crons once a day, which is why the quarter-hourly
  one is GitHub's. A missed tick is made up by the next: what is written depends on the clock, not on how
  many ticks ran.
- **No reader has a branch for it.** The boards, the report, the scoring readers and the event page treat
  the demo's rows exactly as a club's. The label is the only difference on screen.

Three promises `services/demo-club.ts` keeps itself:

1. **It never touches a club that is not the demo.** The club is found by its name AND `isDemo`. A club
   with the demo's name and without the mark is refused, whole, before anything is written
   (`DEMO_NAME_TAKEN`); so is a share token held by some other club's tournament.
2. **Idempotent.** Refresh keeps the club row, deletes its own tournaments and course, and builds them again:
   one club, the same two share tokens (`demoShareTokens`), so every link anybody kept still works.
3. **It sends nothing**, and the senders refuse it besides (below).

Players keep their own cards (`scoreEntryBy: "players"`), so a visitor who opens a card from the landing's QR
can tap a score and see it save. The replay writes the script over every hole a group has PLAYED
(`demoStrokesDue`), so a stranger's tap on a played hole lasts until the next tick. (The round-code card for a
tournament whose cards are kept by staff offers buttons that then refuse to save — seen while building this,
and left alone: it is the play surface's, not the demo's.)

## In dev and in tests

`demoMark()` reads `DEMO_CLUB_MARK`, which production ignores. `playwright.config.ts` and `scripts/qa/round.mjs`
give the test server `demoTestMark()` (`e2e/demo-fixture.mjs`, a per-worktree `zz-demo-…` mark), so the owner
spec's press builds that worktree's own demo, which `removeDemoClub` takes down in a `finally`. The database
tests call `buildDemoClub` with their own mark. Nothing a test does can refresh or remove the bare demo.

## Where it is LEFT OUT, and the test that proves each

Every exclusion is tested with a CONTROL — a real club in the same place is NOT left out — so an exclusion
cannot pass by excluding everybody. All in `src/lib/__tests__/the-demo-club.audit.test.ts` unless named.

| Left out of | Where | Test |
|---|---|---|
| The deploy freeze | `services/deploy-window.ts`: both queries ask `isDemo: false` — a tournament "on today" every day would freeze deploys for ever | demo tournament today → not frozen; a real club's today → frozen |
| The hourly canary | `scripts/prod-smoke.mjs` refuses a board carrying `data-demo-club` | `prod-smoke-refuses-the-demo.test.ts` (real board passes; demo board fails, saying why) |
| Owner analytics and counts | `services/owner-counts.ts` (every count and list on `/owner`), `peopleOwningSeveralParClubs` | totals equal all minus the demo's; a real club is in Newest and Live, the demo is not |
| Interest counts | `interestShown` leaves out the demo's domain (`demo.example.invalid`); the demo writes none | a demo-domain row is not listed, another is |
| Plan limits | `services/limits.ts` `enforcementActive` answers no for the demo, whatever the master switch | demo on the free terms is capped by nothing; a real club on them is |
| Billing | `checkoutUrl` refuses before Stripe (`DEMO_NOT_BILLED`); `setClubPlan` cannot find it | the demo is refused and given no billing row; a real club is not refused for it |
| Listings of real clubs | `otherOrganizationNamed` (the namesake question at sign-up and branding) asks `isDemo: false` | the demo's name finds nothing; a real club's name is found |
| Email, text, push | `services/demo-guard.ts` `demoRefusesMessage`, asked at the wire: the Resend client in `email.ts`, `sendSms` (scope REQUIRED), `sendPushToEmails` (scope REQUIRED) | nothing reaches the wire for the demo or its domain; a real club's does |
| Search engines | `robots.ts` disallows `/demo` (and `/live/`); every demo page says noindex; `/demo/<door>` sends `X-Robots-Tag` | `the-demo-club-is-not-indexed.test.ts`, and `e2e/demo-club.spec.ts` reads the robots meta on each page |

A new place that counts clubs, freezes, limits, bills, lists or sends must ask the same question — and get its
own line here, and its own test with a control.

## The browser specs

- `e2e/demo-club.spec.ts`: a stranger finds no button and builds nothing; the owner creates, then refreshes
  (one club, same boards); a signed-out visitor follows the landing's button and finds the label on every
  demo page; the replay is shut without its token and with it writes what the club's clock says is due.
- `e2e/landing-demo-doors.spec.ts`: the five front-door borrowings, and the editions — a US visitor never
  reads "society", a British one does.

## For Ajay, in production, after the merge

1. Vercel → the project → Settings → Environment Variables, Production: add `DEMO_REPLAY_TOKEN` (a long random
   string). `CRON_SECRET` is already there for the other crons. Redeploy is done by the merge itself.
2. GitHub → the repository → Settings → Secrets and variables → Actions: add `DEMO_REPLAY_TOKEN` with the same value.
3. Open `/owner`, find **Demo club**, press **Create the demo club**, confirm.
