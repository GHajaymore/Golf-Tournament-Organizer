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

**6 Nov: Ajay — before launch the freeze guards only pilot clubs.** "We can't waste time waiting
this long. this kind of real tournament [freeze] we should do at the last when we have all other
foundations and basic issues fixed." The same night: "let's turn off that freez until Nov 20th".
So `deployWindowFor` (`src/lib/domain/deploy-window.ts`) answers in three periods. Until
`FREEZE_RESUMES` (20 Nov 2026 00:00 in UTC+14, which is 19 Nov 10:00 UTC, so it is back before the
20th begins anywhere): never frozen, "the freeze is off until 20 Nov 2026 (the owner's ruling of 6
Nov)". From then while sign-ins are held (`launchState()`): frozen only while a pilot club (a real
club where somebody on `SIGNIN_ALLOW_EMAILS`, and not on `OWNER_EMAILS`, is Commissioner, Admin,
Organizer or helper) has a tournament on today, never on a weekend morning, and the reason begins
"sign-ins are held: only pilot clubs count". Once live: the 2026-10-23 rule unchanged, the reason
beginning "accounts are live: every club counts". Why: a held production signs in only the owners
and the allow-list, so before launch most tournaments are tests. Not all: round codes (`/play`) and
public boards work while held, which is how the real team cup was played, so a real event an owner runs
by round code can be on today — and before launch it does NOT hold a deploy. That is the ruling as
given; whether such events should be covered is a question for Ajay, not built in. The first pilot
club's organizer starts setting up on 20 Nov, which is why the freeze resumes then. A completed
tournament never freezes.

## Moved from CLAUDE.md (20 Nov 2026): What gates a merge, and what gates a deploy

`ci.yml` is the only workflow that runs on its own — every PR, and every push to `main` (since
2026-11-02 a branch push alone runs nothing: open a PR, even a draft, to get its checks). It does the
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

