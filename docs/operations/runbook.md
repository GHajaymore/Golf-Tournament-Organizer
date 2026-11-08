# Runbook: when something goes wrong on an event day

Owner: Operations Lead. Written 2026-11-04 for the first real pilot (a Florida outing, 29-30 Nov,
organizer setup from 14 Nov). This repository is public: no secrets, addresses or names appear here.
Placeholders are in angle brackets. Anything not confirmed from the code or workflows says **To confirm:**.

Companions: `incident-sheet.md` (one page for the person on the course), `rollback-rehearsal.md`
(Thu 12 Nov), `restore-drill.md` (Tue 17 Nov). Background: `docs/claude/deploy-history.md`,
`docs/release-strategy.md`, `CLAUDE.md` ("What gates a merge, and what gates a deploy").

Roles used below: **Organizer** (runs the event), **Tournament Director** (on the course),
**Operations Lead** (this runbook's owner, has Vercel, GitHub and Sentry access), **Owner** (decides on
anything members will see, and on spending).

**Hard rules that apply on the day.** Never write to, seed into or test against an event with real people
in it (Hard rule 1). Never run a database reset. TourneyHQ records money and never moves it, so no
step here involves a payment.

## 1. Is production down or slow?

Check in this order. The first three take under two minutes.

1. **Ask it as a visitor would.** Open `https://tourneyhq.club/api/health`. It answers `{"ok":true}`
   when the database answered a trivial query within 4 seconds, and **503** `{"ok":false}` when it did
   not (`src/app/api/health/route.ts`). The front page is the wrong test: it renders without the database
   and stays 200 through a database outage. A 200 that takes several seconds is "slow": time it with
   `curl -s -o /dev/null -w "%{time_total}\n" https://tourneyhq.club/api/health`.
2. **The read-only smoke.** `node scripts/prod-smoke.mjs` (from a checkout) GETs `/`, `/faq`, `/privacy`,
   `/terms`, `/play` and a missing page (expects 404), with no cookie and nothing written. It is the
   same script the canary and the post-deploy step run.
3. **The canary.** `canary.yml` runs every hour at :41 (the same script, plus one public board when the
   `CANARY_BOARD_URL` secret is set, plus an email-delivery check every third hour). A failed run is the
   alert: GitHub emails the person who last changed the schedule, if their Actions notifications are on.
   Look: `gh run list --workflow canary.yml --limit 5`. **It runs hourly, so it can be up to an hour
   behind: on an event day do not wait for it.**
4. **Sentry.** Server errors only (`src/instrumentation.ts`; no browser reports; tracing off). It is
   switched on only where `SENTRY_DSN` is set. Look at Issues for the production environment, newest first.
   A burst of new issues in the same minute as the complaints is the signal. Reports are scrubbed of link
   tokens and email addresses before they leave.
5. **Vercel runtime logs.** Dashboard, `<VERCEL_PROJECT>`, Logs, filter to 5xx and the last 30 minutes.
   Database trouble reads as `Can't reach database server` / `P1001` (the 2026-09-08 incident in
   `deploy-history.md`).

**What you found, and where it points:**

| You see | Likely cause | First move |
| --- | --- | --- |
| `/api/health` 503, every page with data fails, front page fine | Database unreachable or slow | Check the database provider's status and the Storage tab of `<VERCEL_PROJECT>`. A rollback will not help. Tell the Owner. |
| Everything fails right after a deploy | The new build | Section 4 (rollback). |
| Only one screen fails | A code fault in that screen | Sentry for the stack; if a deploy preceded it, section 4; otherwise tell the Organizer which screen to avoid and use the incident sheet's paper fallback. |
| Site loads but is slow for everybody | Cold functions, database load, or the provider | Time `/api/health` a few times. Slow and 200: watch, do not deploy. |
| Only some people, only at the course | The course's signal, not the app | Compare a phone on mobile data with one on the course network. See section 5. |

**Monitoring and on call (Owner's rulings, 4 Nov 2026)**
- An external uptime monitor checks the home page every 5 minutes and emails the Owner. A second monitor on
  `/api/health` (keyword `"ok":true`, so it fails when the database does) is added before launch.
- Sentry alert rules: `docs/release-strategy.md` lists "Sentry alerts to [the Owner's] email" as planned.
  To confirm: that a rule exists and a test notification reaches the Owner (not yet tested, 4 Nov).
- On call for 29-30 Nov: the **Owner**, with the **Operations Lead** working through the Owner's Claude
  session. The Tournament Director reaches them by the phone number written on the incident sheet.

## 2. What is production running?

Two answers, and after a rollback they can disagree:

- **What the gate believes** (and what deploys are measured from): the newest successful GitHub deployment
  to the environment `tourneyhq-production`, recorded by `deploy.yml` right after each deploy.

  ```bash
  gh api "repos/<GITHUB_REPO>/deployments?environment=tourneyhq-production&per_page=3" -q '.[] | "\(.id) \(.sha) \(.created_at)"'
  gh api "repos/<GITHUB_REPO>/deployments/<ID>/statuses?per_page=1" -q '.[0].state'   # success
  ```
  The same list is on GitHub: repository, Deployments, `tourneyhq-production`.
- **What is actually serving:** Vercel dashboard, `<VERCEL_PROJECT>`, Deployments. The one labelled
  Production / Current is live. **Vercel is the truth for what members get.** The GitHub record is
  written only by `deploy.yml`, so a dashboard rollback or promote does not update it (section 4).

To confirm: whether `VERCEL_GIT_COMMIT_SHA` (used as the Sentry release in `instrumentation.ts`) is set
for deployments made by the CLI from the Actions runner. If it is, Sentry's release names the commit; if
not, it is blank and Sentry cannot tell you which build threw.

## 3. The deploy gate and the freeze

Production changes only through `deploy.yml` (Vercel's own Git deploy for `main` is off in `vercel.json`).
It is called by `ci.yml` after `verify` is green, by the nightly round after a clean verdict, hourly at
:23, and by hand (Run workflow). It uploads the source and **Vercel builds it**; the build runs
`prisma migrate deploy` against production, which is why the runner never holds production database
credentials.

`scripts/qa/deploy-gate.mjs` (rules in `deploy-rules.mjs`) decides **deploy**, **hold** or **done**:

1. `verify` must be green on the commit.
2. Every core or function change since the last deploy must be inside a clean nightly round
   (`nightly.yml`, about 02:17 UTC).
3. No club may be in its **freeze**.

**The freeze** is a tournament on today, by the club's own clock (a round dated today, or a tournament
of at most a week whose dates take in today), or **Saturday or Sunday 05:00-14:00 in any club's time zone**
(`src/lib/domain/deploy-window.ts`). Demo clubs are left out. **That is the rule once accounts are
live (Ajay, 2026-11-06):** until 20 Nov 2026 (`FREEZE_RESUMES`) the freeze is off, and from then while
sign-ins are held only a pilot club (somebody on `SIGNIN_ALLOW_EMAILS` is its staff) playing today
freezes, never a weekend morning. The `reason` says which rule applied. The app answers the question itself at
`/api/deploy-window`, returning only `{frozen, reason}`:

```bash
# The token is a secret. Put it in your shell with `read -s DEPLOY_WINDOW_TOKEN`, never in a file, a chat or this repo.
curl -s -H "Authorization: Bearer $DEPLOY_WINDOW_TOKEN" https://tourneyhq.club/api/deploy-window
```
`401` means the token is wrong or missing in Vercel. `503` means the database could not be asked.

**A hold is green.** It is the gate working; the summary names the reason ("Deploy gate: hold") and the
hourly run tries again. Read it: `gh run list --workflow deploy.yml --limit 5`, then open the run's summary.
If the freeze cannot be asked (no token, 401, 503, unreachable) the gate deploys as **unfrozen** and says
so in the summary. During an event, treat "not checked" as "frozen" and hold merges yourself.

**Override.** `deploy.yml` Run workflow with *Override freeze* is for an emergency fix that cannot wait for
the clubs to finish. It overrides only the freeze: a core change still needs a clean nightly round
(run the Nightly round by hand; about forty minutes).

**Event days.** The Florida event is on a Sunday and Monday (29 and 30 Nov). Before launch the weekend rule
is OFF (2026-11-06), so the "tournament on today" rule is the only cover, and it covers both days **only if
the club is a pilot club and the event has its dates or round dates entered**: the Organizer's address
must be on `SIGNIN_ALLOW_EMAILS` and they must be the club's Commissioner or Admin, or an Organizer on the
event, and they must enter the dates during setup (To confirm: that the event shows as frozen on
`/api/deploy-window` once dated — the reason then begins "sign-ins are held: only pilot clubs count, and 1
pilot club is playing"). A separate program hold on changes around the event
is planned; its dates are not settled in the repository (see To confirm below).

Other gate failures that are not the code (`deploy-history.md`): an invalid `VERCEL_TOKEN` (run
`vercel whoami` first), an unreachable production database during the build, the 100-deployments-a-day
allowance (every push counts), and a cancelled job after a long "Completing..." where Vercel may already
show the deployment Ready (check the dashboard for that SHA before re-running).

## 4. Rolling back on Vercel

**What it is.** Vercel's Instant Rollback points production at the previous production deployment's
already-built output. No build, no migration, usually seconds to a minute. Dashboard: `<VERCEL_PROJECT>`,
Deployments, choose the earlier Production deployment you want, the menu, **Instant Rollback**.
CLI equivalent: `vercel rollback <deployment-url-or-id>`.

**Roll back when**
- The problem began with a deploy (errors or broken screens started within minutes of "Deploy" going
  green, or Sentry shows new issues tagged to the new build), **and**
- the previous deployment is known good (the canary was green on it), **and**
- the migrations between the two are additive. Check:
  `git diff --name-only <good-sha> <bad-sha> -- prisma/migrations` and read any SQL listed. A column or
  table the old build needs must still exist. `docs/release-strategy.md` states the intent that every
  migration after launch is additive and a column is dropped only a release after nothing reads it; before
  launch that is not guaranteed, so look.

**Do NOT roll back when**
- The fault is the database, the provider, DNS, a certificate, an environment variable or a third party
  (email, SMS). The old build has the same problem. `/api/health` 503 with no recent deploy is this.
- The new migration removed or renamed something the old build reads. The old build will fail in new ways.
- The problem is wrong data (a mistyped score, a wrong handicap). That is a correction in the app, not a code fault.
- You cannot tell what went wrong. Spend two minutes on section 1 first; if scores are being entered,
  a wrong rollback costs more than waiting.
- It is the **rehearsal** and a freeze is in force or a real event is on. See `rollback-rehearsal.md`.

**During an event or a freeze.** A rollback is an incident response, not a deploy, but it still changes
what members are running mid-round. Operations Lead decides, tells the Owner and the Tournament Director
first if time allows ("about a minute, pages may reload"), and does it only to stop active harm. The Owner
ruled on 4 Nov 2026: the Operations Lead **may** roll back inside a freeze or on an event day **without asking
first**, because a rollback returns to the version that was running before and never touches data. The Owner
is told straight after.

**After a rollback, three things are now different:**
1. **Merges stop.** Tell whoever merges to `main` to hold. The hourly `deploy.yml` run will happily ship
   a new commit, and the broken commit is still on `main`. (The gate reports "done" for the bad commit
   itself, since its record says production holds it.)
2. **The GitHub record is stale.** It still names the bad commit. Write the real state in the incident log.
3. **Vercel may stop auto-assigning new deployments to the production domain** until one is promoted
   or auto-assignment is turned back on. To confirm in the dashboard banner after the rehearsal. If true,
   a fix deployed by `deploy.yml` will build but not go live until promoted.

**Going forward again:** fix on a branch, merge once through the normal gate (`verify` and, for core
changes, the nightly; use *Override freeze* only for an emergency), then confirm in Vercel that the new
deployment is Production / Current. If the fix is already the next build, promote it from the dashboard.

## 5. Scores entered with no signal

The code has an offline path for **players' phones**. I read it; this is what it does, not what I assumed.

- **Where.** `src/lib/domain/pending-card.ts` and `src/components/usePendingCard.ts`, used by the
  hole-by-hole card, group scoring, the round-code play screen (`PlayClient`) and the match keepers.
- **How.** Every change is written to the phone's `localStorage` (key `tourneyhq:pending-card:<round>:<player>`)
  **before** the network is tried, and deleted only when the server has read the card back. It retries
  every 15 seconds and sends by itself when signal returns. Each hole shows **On your phone**, **Sent** or
  **Not sent**. After about two minutes unsent, the wording tells the player to show the card to the
  committee if it is still "On your phone" at the finish.
- **If the server holds a different card** (a committee correction while the phone was offline), nothing is
  overwritten silently: a chooser shows both and asks (`CardConflict`).
- **Some formats hold the whole card until the finish**: "Saved on this phone. This tournament takes the
  whole card, so it goes in when you finish."
- **What it cannot do.** Local storage is lost if the person clears the site's data, uses private browsing
  (the screen warns), or runs out of space. The service worker (`public/sw.js`) caches **only** icons and
  the manifest, deliberately never pages: a page that is not already open will not load with no signal,
  and a reload of the scoring screen while the server is down will not open. **Tell players not to close
  or reload the app, clear data, or sign out while a hole says "On your phone".**
- **If the app itself is down** (not just their signal): an open scoring screen keeps accepting holes and
  keeps them on the phone. When the app returns they send by themselves, provided the phone's browser data
  is intact. Rolling back or deploying does not touch phones.
- **The organizer's console has no offline queue.** `usePendingCard` is not used by the console's Entry
  screens (Hole by hole / Full card / Voice). If the app is down, the committee enters from paper
  afterwards. To confirm: that the console really has no other offline path, and whether the Capacitor
  (iOS/Android) or Electron packages add one. The code I read does not show one.

## 6. After every incident (within a day)

Record in one place the Operations Lead keeps (not in this public repository if it names anyone): time first
reported, who reported, what was seen, what was checked, what was done and when, the deployment in force
before and after, and whether any score was lost. Add the cause and a prevention to `docs/claude/deploy-history.md`
if it was a deploy or gate fault. Do not paste player names, emails, phone numbers or scores of real people
into the repository (Hard rule 2).

## To confirm (questions for the Owner or Operations Lead)

1. ~~Uptime monitor on `/api/health`~~ Settled 4 Nov: added before launch (section 1).
2. Are Sentry alert rules in place, and does a test notification reach the Owner? (Not yet tested, 4 Nov.)
3. ~~On call for 29-30 Nov~~ Settled 4 Nov: the Owner, with the Operations Lead (section 1).
4. ~~Rollback without asking~~ Settled 4 Nov: yes, Owner told straight after (section 3).
5. Does the freeze know about the Florida event once dated (check `/api/deploy-window` after setup)?
6. The program's hold on changes is **14 Nov – 1 Dec** (delivery plan approved 4 Nov; the older
   `docs/print-kit-panel-2026-10-30.md` said 19 Nov). To confirm: whether it also stops the hourly deploy,
   or only merges of app changes.
7. Do Vercel deployments made by the CLI from Actions carry `VERCEL_GIT_COMMIT_SHA`?
8. After an Instant Rollback, does the Vercel project stop auto-assigning new production deployments?
9. How will pilot players and the Organizer sign in while production sign-ins are held (`src/lib/sign-in-gate.ts`: only owners and `SIGNIN_ALLOW_EMAILS`; players may use `/play`)? Is the Organizer on the allow list, or will sign-ins open before 14 Nov?
10. Does the Capacitor or Electron packaging add any offline behaviour beyond section 5?
