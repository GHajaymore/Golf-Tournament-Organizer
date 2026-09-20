# Certifying a build

What "tested" means here, what it costs, and the one thing that cannot be
certified the same way in every environment.

## The scenario suite is the seeded club, not a list of steps

`scripts/seed-club.mjs` builds a whole club in the development database: 36
invented members, two courses, and eleven tournaments covering every state a
club is actually in — a live medal with a half-entered card, a championship
with a cut, a knockout, a weekly league, a team invitational, a twilight nine,
registration open, a waiting list, an unplanned draft, and a **Festival of
Formats** that plays one round of every format in `src/lib/formats.ts`.

```bash
node --env-file=.env scripts/seed-club.mjs             # seed + print cookies
node --env-file=.env scripts/seed-club.mjs --teardown  # remove everything
```

It refuses any database whose host is not `localhost`, checked on the host
rather than on the URL — a password can contain the word "localhost".

**Why a seeded club rather than a test plan.** On 2026-09-19 and 2026-09-20,
walking it found fifteen user-facing defects that 8,000 unit tests, 1,200 audit
tests, the smoke pass and 644 Playwright tests all passed. Every one was the
same shape: two screens answering one question differently, each function
individually correct, and nothing anywhere comparing the two answers. A test
suite is blind to that by construction. Eyes on real rows are not.

`src/lib/__tests__/seeder-plays-every-format.test.ts` keeps the club complete:
a format added to the catalogue fails there the day it is added.

## The gate, in the order it is cheapest to fail

```bash
npx tsc --noEmit
npx vitest run
npx next lint
npx vitest run --config vitest.audit.config.ts   # needs a database
npm run smoke:all                                 # builds, then five scripts
AUTH_SECRET=local-e2e-secret npx playwright test  # three viewports
```

**Capture the COUNTS, not the tail.** On 2026-09-20 a gate script piped each
run through `tail -3` and never captured its exit code, so a red unit test
printed a Duration line and the script exited 0. A check whose failure looks
like its success is not a check. Grep for `Tests ` and record
`${PIPESTATUS[0]}`.

**Never run two Playwright suites at once.** They share port 3101 and
`.next-e2e`; a collision once reported 405 failures that were entirely the
collision.

## Preview and production: what can and cannot be certified

**`SMOKE_BASE_URL=https://tourneyhq.club node scripts/smoke-routes.mjs` does
not certify production, and it will tell you that it does.** The script seeds
its own fixture into whatever `DATABASE_URL` points at — the DEVELOPMENT
database — and signs a session cookie with the LOCAL `AUTH_SECRET`. Point it at
production and every console route redirects that cookie to sign-in: 307, which
the script counts as a pass, over a page it never saw. Forty routes then report
"ok" having rendered nothing. That is the failure CLAUDE.md describes as a
check reporting an absence of problems in an absence of content, and it looks
exactly like a clean run.

What IS safe against a deployed build is anything public and read-only: the
landing pages, and a `/live/<token>` share link for a tournament already there.
Read those with a cache-busting query, because `/live` has its own server-side
board cache as well as the browser's.

**And seeding is not an option there at all.** Preview deploys and production
currently share one database — the split is still pending — so seeding a club
"into preview" writes it into production. The seeder refuses any non-localhost
host, and the refusal is correct.

So a deploy is certified in two halves, and the second half is deliberately
smaller than the first:

1. **Locally, against the seeded club**: the full gate above, plus a walk of
   the screens the change touches, reading the numbers on each against the
   numbers on the others rather than against expectation.
2. **Against the deployed build**: that the `Deploy to production` job for the
   merge commit actually succeeded, and a read of the public screens. Nothing
   is written, and nothing authenticated is claimed.

Anything needing new rows in production waits for the preview database split.
Saying a change is "certified in production" when only step 1 has been done is
the kind of claim this file exists to stop.

## Checking that a merge actually shipped

`gh pr checks <n>` answers "is this PR green", which is **not** "is this commit
green". On 2026-09-20 an auto-merge counted the previous head's checks and
merged seconds after a second commit was pushed; the PR closed, `main` took the
first commit only, and nothing in the output said so.

Read check-runs for an explicit SHA, merge with `--match-head-commit`, and
afterwards confirm the work is on `main` rather than trusting the word MERGED:

```bash
git show origin/main:path/to/file.ts | grep -c theSymbolYouAdded
```
