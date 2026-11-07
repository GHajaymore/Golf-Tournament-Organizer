# Rollback rehearsal: Thursday 12 November 2026

Owner: Operations Lead. Present: the Owner (to approve) and whoever merges to `main` (to hold merges).
Goal: prove we can move production back to a known-good deployment and forward again, and learn how long
each step takes. Background and the real-incident version: `runbook.md` section 4.

## What is safe, and what is not

**Safe (this is the whole rehearsal):**
- Rolling production back to the previous production deployment, then forward again, using Vercel's
  Instant Rollback and Promote. Both only move which already-built deployment serves the production address.
- Read-only checks: `GET` of public pages, `/api/health`, `/api/deploy-window`, the GitHub deployment list.

**Never, in this rehearsal:**
- **Never during a freeze.** The freeze is a tournament on today at any club (real clubs only), or a
  Saturday or Sunday 05:00-14:00 in any club's zone (`deploy-window.ts`). Thursday is not a weekend, but
  step 1 asks the app rather than assuming. (Since 2026-11-06 that is the rule once accounts are live:
  the freeze is off until 20 Nov 2026, then guards only pilot clubs while sign-ins are held.)
- **Never touch the database.** No `prisma` command, no migration, no SQL, no restore, no reset. Instant
  Rollback runs no build and no migration. If a step seems to need the database, stop.
- **Never test against, seed into or edit a real event** (Hard rule 1). Do not sign in to look at one. The
  checks use public pages only.
- Do not push to `main`, merge anything, run the Run workflow button on `deploy.yml`, or trigger a build
  during the rehearsal. A merge now would race the rollback.
- Do not change environment variables, domains or project settings.

## Before (go / no-go; all must be yes, else reschedule)

1. **Not frozen.** Ask the app (put the token in with `read -s DEPLOY_WINDOW_TOKEN`; never paste it anywhere):
   `curl -s -H "Authorization: Bearer $DEPLOY_WINDOW_TOKEN" https://tourneyhq.club/api/deploy-window`
   Expect `{"frozen":false,...}`. **`401` or `503` is a no-go** (we have not been able to ask). Also check
   with the Organizer that no pilot club is playing or doing setup that day.
2. **Timing.** Start at about :45 past an hour and finish before :20. The canary runs at :41 and the hourly
   deploy at :23. Avoid 09:15 and 16:00 UTC (scheduled jobs in `vercel.json`).
3. **Nothing pending.** No merge to `main` in the last hour and none planned. `gh run list --workflow deploy.yml --limit 3`
   shows no run in progress, and the last hourly one is green or a hold.
4. **Production is healthy now.** `/api/health` answers `{"ok":true}`, and the last canary run is green.
5. **A known-good target exists.** In Vercel, `<VERCEL_PROJECT>`, Deployments: the current Production
   deployment (call it **N**) and the one before it (**N-1**), both Ready. N-1 was Production while the canary
   was green. Write down both deployment ids and their commit SHAs.
6. **Migrations between N-1 and N are additive.** `git diff --name-only <N-1 sha> <N sha> -- prisma/migrations`.
   If a migration is listed, read the SQL. If it drops or renames anything N-1 reads, pick a different
   pair or stop. (For a rehearsal this protects the members who happen to load a page.)
7. **The Owner has said yes.** Sign-ins are held to owners, so members see little, but the rehearsal still
   changes live production.

Record the start time and the values in the table at the bottom.

## Steps

Time every step from your first click to the confirmation.

**Step 1. Baseline (about 2 minutes).**
Note N (Production / Current badge). Run `/api/health` (200) and
`node scripts/prod-smoke.mjs` (all doors pass, exit 0). Fingerprint the live build:
`curl -s https://tourneyhq.club/ | grep -o '"b":"[^"]*"' | head -1`. To confirm: that this shows a build id
on the live site; if not, use the dashboard badge as the only fingerprint.
Confirm: all three pass. Otherwise stop.

**Step 2. Roll back to N-1 (expect under 1 minute).**
Vercel, Deployments, N-1, menu, **Instant Rollback**, confirm. (CLI: `vercel rollback <N-1 url or id>`.)
Confirm: the dashboard shows N-1 as Production / Current and a banner about the rollback; the build
fingerprint from Step 1 is different (cache can lag: use `?bust=1`); `/api/health` 200; `prod-smoke.mjs` passes.
If any check fails after 5 minutes: go straight to Step 4 (roll forward) and record it.

**Step 3. Observe (about 5 minutes).**
Read the banner and the project settings page **without changing anything**: does it say new production
deployments will no longer be assigned to the domain automatically? Record the exact words. Check the
GitHub deployment list: it still names N (the record is not updated by a dashboard rollback). Record that.
Check Sentry for new issues. (Starting at :45 keeps the :41 canary and the :23 hourly deploy out of the window.)

**Step 4. Roll forward to N (expect under 1 minute).**
Vercel, Deployments, N, menu, **Promote to Production** (or the banner's re-enable action if offered).
Confirm: N is Production / Current; the banner is gone or says auto-assignment is back on; the build
fingerprint matches Step 1 again; `/api/health` 200; `prod-smoke.mjs` passes.
Also confirm the project's setting for automatic production assignment is back on, so the next normal
deploy goes live. If it is not, turn it back on now and record that it was needed.

**Step 5. Close (about 3 minutes).**
Tell whoever merges: "merges may resume". Open the next hourly `deploy.yml` run (:23) and confirm its
summary reads `done` or `hold` with the reason, not red. Add today's results to the table and attach it to
the incident log (not this repository, if it holds anything beyond times and ids).

## Expected times

| Step | Expected | Stop and ask if |
| --- | --- | --- |
| Baseline | 2 min | any check fails |
| Roll back | under 1 min | not Current after 3 min |
| Observe | 5 min | anything unexpected in Sentry |
| Roll forward | under 1 min | not Current after 3 min |
| Whole rehearsal | 15 min | over 30 min |

These are expectations from Vercel's description of Instant Rollback and the planning note in
`docs/release-strategy.md` ("a rollback that takes a minute"), not measured figures. Today's run is the first measurement.

## If something goes wrong mid-rehearsal

Roll forward to N (Step 4) first, then diagnose. Do not deploy, merge or touch the database to "fix" it.
Rolling forward restores exactly what production held before. If Vercel will not promote, that is a real
finding: escalate to the Owner and Vercel support, and record it.

## Record (fill in during the run)

| Item | Value |
| --- | --- |
| Date, start and end time (UTC) | |
| N and N-1: deployment ids and SHAs | |
| Freeze answer before (exact text) | |
| Time to roll back / roll forward | |
| Banner text after rollback (auto-assign?) | |
| GitHub deployment record after rollback | |
| Build fingerprint worked? | |
| Auto-assignment restored? | |
| Anything surprising | |
| Changes to make to `runbook.md` | |

## To confirm

1. The Vercel plan's rollback limits (some plans roll back only to the previous deployment).
2. Whether Instant Rollback also returns environment-variable values to those of N-1.
3. Whether auto-assignment of production domains is switched off by a rollback in this project, and how it is restored.
4. Who holds `DEPLOY_WINDOW_TOKEN` and may run the freeze check.
