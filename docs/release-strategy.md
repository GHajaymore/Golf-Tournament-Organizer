# Release and test strategy — from now to launch, and after

Owner: the QA manager (Ajay, 2026-10-19: "our QA manager should take on the
preview environment and should formulate the solid test strategy when we go
live … even before that … implement, keep testing and improve upon so we are
ready for post launch changes or bug fixes/enhancements").

This is a living document. Each step below says whether it is **in place**,
**being built** or **planned**, and is only marked in place once it has been
seen to catch something. `docs/testing.md` is the test suite's own manual; this
is about how a change travels from a branch to members' phones, and how we
find out — and recover — when something gets through.

## What prompted it

Every preview deploy failed for days and nobody looked. The preview database
held a failed `A003_contest_sponsor`: a preview had applied the sponsor
migration under its first name, `A001_contest_sponsor`, and after the rename
the next preview added the same columns again, failed, and stopped every
preview after it at `P3009`. The check is not required for merging, so it read
as noise. It was the one environment that rehearses production's migrations,
and it had found a real class of fault: **renaming a migration that has
already run somewhere.** Fixed in Neon on 2026-10-19 (A003 marked applied, the
columns being there); production never ran either name.

## The four environments

| Where | Database | What it is for |
| --- | --- | --- |
| A developer machine | `localhost/tourneyhq_dev` (demo data) | writing and the local gate |
| CI (GitHub Actions) | a fresh Postgres per run | the gate: types, unit, audit, build, smoke, Playwright ×3 |
| **Preview** (Vercel, every branch) | `tourneyhq-preview` on Neon, separate from production | the **dress rehearsal**: the real build, the real host, migrations applied to a database that has history |
| **Production** (tourneyhq.club) | Prisma Postgres | members. Nothing is tested here that writes |

Production and preview are separate databases since 2026-08-30. A preview
migrates its own database (`scripts/deploy-migrations.mjs`); production is
migrated only by a production deploy, which runs only after `verify` is green.

## The gates a change passes, by size

`npm run qa:changed` names the class; the class names the gate.

| Class | Before merge | After merge |
| --- | --- | --- |
| Tests, tooling, words only | its own tests, CI | production smoke |
| Function in one area | a browser test that does it, proven by breaking the code; CI; **one** round | outside the deploy freeze; production smoke |
| Core and shared | the same, with that one round visiting **all six** countries (money or handicap arithmetic: **three** rounds, for now) | held until the **nightly** round on main is clean on a commit containing it; outside the freeze; production smoke, and a look at Sentry after 30 minutes |

Since 2026-10-23 (the testing panel, `docs/testing-panel-2026-10-23.md`) the "after merge" column
is enforced by `deploy.yml`'s gate rather than remembered, and the freeze — a tournament on today
at any club, in its own time, or a weekend morning 05:00–14:00 in any club's zone — holds every
class. An hourly production canary (`canary.yml`) watches the public doors and one public board
between deploys.

And, for every change: **its preview must build.** A failed preview is a
finding, read the same day — it is the first place a migration meets a
database that is not empty.

## Steps, in order

1. **The preview builds, and someone notices when it does not.** — *preview
   building again from 2026-10-19 (a green preview of `805082c5` proved the fix);
   a check that says so: being built.* A daily job
   reads the last preview of `main`'s open pull requests and opens an issue
   when one failed at the migration step.
2. **Production is smoke-tested after every deploy.** — *in place from the
   merge that carries it (`scripts/prod-smoke.mjs`, the last step of the deploy
   job); proven to fail on a wrong address before it shipped.* After
   `Deploy to production`, a job requests the public routes of tourneyhq.club
   — the front page, FAQ, privacy, terms, the round-code page, sign-in — and
   fails on any 5xx or a missing page. Read-only: it signs nobody in and
   writes nothing.
3. **The preview is tested like production, not only built.** — *planned;
   needs Ajay:* previews are behind Vercel's login, so automation needs a
   **Protection Bypass for Automation** secret (Vercel → project → Settings →
   Deployment Protection). With it, each preview gets the route walk and the
   public-board checks against the real host and the preview database's seeded
   demo club.
4. **A rollback that takes a minute, rehearsed.** — *planned.* Vercel's
   Instant Rollback returns the previous production deployment without a
   build. Migrations are the catch: after launch every migration is ADDITIVE
   (new tables, new columns with defaults) and a column is dropped only a
   release after nothing reads it, so the previous build always runs against
   the newer schema. A rollback is rehearsed once before launch on a preview.
5. **Migrations are never renamed once pushed.** — *in place as a rule;
   test planned.* The A003 incident. A migration folder that has existed on
   any pushed branch keeps its name; a new number is a new migration.
6. **Watching production.** — Sentry (errors) since 2026-10-14; page
   analytics since 2026-10-19 (`NEXT_PUBLIC_ANALYTICS`); an hourly canary of
   `/`, `/faq`, `/play` and one public board since 2026-10-23 (`canary.yml`, a
   failed run is GitHub's email). *Planned:* Sentry alerts to Ajay's email.
7. **After launch: two lanes.** — *planned.*
   - **Release lane** (features, enhancements): batched, the rounds its tier
     asks for (`npm run qa:changed`) on the release commit, the nightly before a
     core change ships, merged one at a time, production smoke after each.
   - **Fix lane** (a member-facing bug): one branch per fix, a browser test
     that reproduces the bug and goes green with the fix, CI, one round,
     preview checked, merged on its own, production smoke. Target: a
     member-reported bug fixed and live the same day.
   Ajay's preview rule for the landing page applies to both lanes.
8. **Real data stays out of tests.** — *in place.* CLAUDE.md hard rules 1 and
   2: nothing is seeded into, or tested against, an event with real people,
   and no member data is committed. After launch that is every production
   event; synthetic checks in production are read-only.

9. **A production deploy never waits behind tests.** — *in place from the
   merge that carries it.* On 2026-10-19 two full rounds (~30 parts each)
   held every GitHub runner the free plan gives (about twenty jobs at once),
   and `main`'s verify-and-deploy sat queued for an hour behind them. Each
   round then ran eight parts at a time. The account is on GitHub Pro (its
   profile shows the PRO badge, 31 Oct; about forty jobs at once), so since
   2026-10-31 a round runs twelve (`round.yml`, `max-parallel: 12`), and **no
   more than two rounds run at once** — the nightly counts as one; push the
   third when one has finished. Two at twelve, with their setup jobs, still
   leave about ten for CI and the deploy job.

   The panel's rule (31 Oct) for moving it, over the first three rounds at
   twelve (one beside the nightly), measuring wall-clock, INCOMPLETE parts,
   install-timeout lines, the deploy job's queue time and the peak of jobs at
   once: **raise to sixteen** only if a round beside the nightly kept every
   deploy queued under 5 minutes, INCOMPLETE parts did not rise, and twelve
   saved about 20 minutes; **go back to eight** if a deploy or `verify` waits
   over 10 minutes behind rounds, more than 2 parts a round are INCOMPLETE, or
   GitHub answers a 403 secondary rate limit.

## How we know it is working

The testing board (`testing-board` in memory) carries the figures. The ones
this strategy adds:

- previews of the last 7 days that built (target: all);
- production smoke after each deploy (target: every deploy, green);
- time from a member-facing bug report to a live fix (target: same day);
- Sentry errors per day in production (watched, not targeted, until there is
  traffic to compare against).

This file is updated whenever a step moves, with the date.
