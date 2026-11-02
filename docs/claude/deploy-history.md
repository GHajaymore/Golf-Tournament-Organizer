# Deploy and merge history

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: a deploy failed or is missing; batch merges. Index: `CLAUDE.md`.

Until that day Vercel shipped `main` on push, BEFORE `verify` finished, and a bad commit
was REPORTED rather than stopped. On 2026-09-03 twenty-seven merges each deployed
unverified. Nothing went wrong; nothing was preventing it either.

**The deploy job does not build.** It uploads the source and Vercel builds it, exactly as
before. Building in CI and shipping with `--prebuilt` is the obvious improvement and is
wrong here: `vercel-build` is `pad-migration-names && deploy-migrations && next build`, so
it runs `prisma migrate deploy` against the PRODUCTION database. Building on the runner
would put production database credentials on a GitHub runner and move schema migrations
into CI. The symptom, if anyone tries again, is Prisma refusing an empty URL — Vercel does
not hand `vercel pull` a sensitive value, and that refusal is correct.

`VERCEL_TOKEN` is the only secret; `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` sit in the
workflow because they are identifiers, not credentials. If the deploy fails, check the
token FIRST and check it directly — `vercel whoami`. An invalid token reports
"Could not retrieve Project Settings", which reads like a permissions or id problem and
is not one. That error cost two wrong fixes before anyone ran `whoami`.

**The other way `deploy` fails is the production DATABASE, and it is not the token.** Because
`vercel-build` runs `prisma migrate deploy`, an unreachable production database fails the build:

```
Invalid `prisma.$queryRawUnsafe()` invocation:
Can't reach database server at `db.prisma.io:5432`
Error: Command "npm run vercel-build" exited with 1
```

That happened on 2026-09-08 to `8c1d75b`, a documentation-only commit — `verify` passed in full
and only `Deploy to production` went red, which is the shape that tells you it is not the code.
The next merge deployed normally and carried it, because git history is cumulative.

**And the third way `deploy` fails is the DEPLOYMENT ALLOWANCE, which is neither.** On
2026-09-09 it went red on `17db490` with `verify` fully green:

```
Error: Resource is limited - try again in 24 hours
(more than 100, code: "api-deployments-free-per-day")
```

A hundred deployments a day on the free plan, and **every push counts**, not every merge.
A branch pushed four times is four preview deploys; a merge is one more. Fourteen PRs in an
evening, each amended and force-pushed a couple of times, is comfortably a hundred — which is
how a working night ends with production quietly not updating.

It is SELF-CLEARING and it is intermittent, so do not read one red deploy as an outage. The
counter is rolling: `17db490` failed, `8a67263` deployed twenty minutes later, and because git
history is cumulative that one carried the failed commit's changes with it. Production was
never more than one merge behind.

What it should change is BEHAVIOUR, not configuration. Batch the work into fewer, larger PRs
and push each branch once. Opening a PR per small improvement is the habit that spends the
allowance, and the allowance is shared with the previews a human needs to review anything.

**And the fourth reads CANCELLED, and production may be fine.** On 2026-09-18
`ad73af3` (#470) had `verify` green and `Deploy to production` cancelled at
exactly 20 minutes — the job's `timeout-minutes`. The log ended:

```
Building…
Completing…
##[error]The operation was canceled.
```

Vercel's dashboard showed that same deployment **Ready, Production, built in
1m40s**, promoted twenty minutes earlier. The build finished; the `vercel` CLI
on the runner hung waiting to be told so, and the timeout killed the CLI rather
than the deploy. A re-run of the job deployed the same commit a second time,
which changed nothing and spent one deployment from the allowance.

So a CANCELLED deploy after a long `Completing…` is NOT evidence production
missed the commit. Check the Vercel dashboard for that SHA before re-running —
and if it is Ready and marked Production, there is nothing to do.

Two more things that cost time here. `--delete-branch` from a worktree fails
with `'main' is already used by worktree` on a merge that SUCCEEDED, so a
script reading the exit code announces a refusal over a merged PR — take the
verdict from `gh pr view --json state` instead. And afterwards, confirm the
work is actually on `main` rather than trusting the word MERGED:

```bash
git show origin/main:src/path/file.ts | grep -c theSymbolYouAdded
```

Related: `main` is exempt from `cancel-in-progress`. Two merges a minute apart used to leave
the first one's `verify` reading `cancelled` on a commit already in production — a deploy
with no verdict at all. Still right for the plainer reason that a cancelled check is a
missing verdict. Feature branches still cancel.

**That exemption protects a run that has STARTED, not one still queued**, and the difference
shows up the moment you merge a batch. GitHub allows one RUNNING and one PENDING run per
concurrency group; a third arrival cancels the pending one, and `cancel-in-progress: false`
does not enter into it. So merging nineteen PRs in thirteen minutes on 2026-09-05 left
**fifteen of them cancelled** — every one killed while queued, with zero jobs ever started —
and four green.

Nothing shipped unverified, and the reason is worth knowing rather than assuming: `deploy`
has `needs: verify`, so a cancelled verify means the deploy job never runs at all. Production
only ever received the commits whose gate actually went green, and because the last one is
the tip it carried everything before it. The gate held exactly as designed.

What it costs is the AUDIT TRAIL. `gh run list --branch main` now shows a wall of
`cancelled` against real merge commits, and nothing in that output distinguishes "cancelled
while queued behind a newer merge, never deployed" from "cancelled mid-flight on a commit
that went out" — which is the exact confusion the paragraph above was written to prevent.
Reading it later, you cannot tell which commits were ever verified.

So: **merge one at a time and let each `verify` finish** when the history needs to mean
something — a release, anything you may have to reconstruct afterwards. It costs about eight
minutes a PR. A batch merge is fine when you only care that the TIP is green, which is the
common case; just do not then read the run list as evidence about the commits underneath it.

To check whether a specific commit was verified, ask for its run rather than scanning the
list: `gh run list --branch main --json headSha,conclusion`. A commit with no successful run
was never verified, whether or not the code in it is now live under a later one.

The two mobile workflows are scaffolding, not pipelines. `android-release.yml` reads five
secrets and `ios-testflight.yml` seven; the repository holds NONE of them. (`gh secret list`
is no longer empty — it has held `VERCEL_TOKEN` since 2026-09-04 — so read the names rather
than the count.) Both are `workflow_dispatch` only, so nothing goes red on a push, but "Run
workflow" fails at signing. That is a missing certificate, not a broken file.
