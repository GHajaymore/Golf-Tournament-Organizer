# Project context — start here (any model, any session)

This file is the **cross-AI onboarding + handoff** for TourneyHQ. It lives in the
repo on purpose: the context a new session needs must be readable by any model,
agent, or teammate — not locked in one tool's private memory. If you are picking
this project up cold, read this, then `CLAUDE.md`, then the `docs/` files it
points to.

Convention going forward: **durable documentation — designs, decisions, project
state — goes in `docs/` (plain Markdown), not in a tool's memory.** Keep this
file current when state changes.

## What it is

TourneyHQ — golf tournament & league management. Next.js 15 (App Router), React
19, TypeScript, Prisma 6, PostgreSQL. Deployed on Vercel (`main` →
`tourneyhq.club`). Also packaged for iOS/Android (Capacitor) and desktop
(Electron). It **calculates and records money; it never moves money.**

## Hard rules (do not break) — full text in `CLAUDE.md`

- Never modify/seed/test against an event holding real people; production holds
  real member PII. Dev DB is `localhost/tourneyhq_dev` (demo data).
- The GitHub repo is **public** — no player PII in commits, fixtures,
  screenshots, or logs.
- `main` auto-deploys to production. Say so before pushing to it.
- Commit with explicit paths (never `git add -A`). Never `git stash` (shared
  stack across worktrees). Never `prisma migrate reset`.
- Never rewrite a source file with PowerShell (its read corrupts UTF-8) — use the
  edit tools. On Windows, prefer PowerShell for git/commands; the Bash tool here
  is unreliable (dumps env / EOF on complex commands).

## How to ship (the gate + deploy discipline) — details in `CLAUDE.md`

Before shipping anything non-trivial:
`npx tsc --noEmit && npx vitest run && npx next lint && NEXT_DIST_DIR=.next-ci npx next build`,
plus `npx vitest run --config vitest.audit.config.ts` for anything provable only
against real rows (money, handicaps, authorization), plus Playwright for
UI-observable change. Mutation-verify every new test (revert the fix → test goes
red → restore). Ship as a PR, merge **SHA-pinned**
(`gh pr merge <n> --squash --match-head-commit <sha>`), and confirm the
`Deploy to production` job — "merged" is not "live". Known intermittent CI
flakes (re-run the same commit, don't edit code): Chromium SEGV on
`organizer.spec` desktop, React "Client Manifest" (`build-checked` guards it),
`next/font` fetch failures — all documented in `CLAUDE.md`.

## Current state (as of 2026-09-25)

**Shipped & live in production this session:**
- #611 — player position shows "Not started" (not a false rank) on the boards;
  settled Nassau shown live on `/me/money`.
- #612 — net scorecards show gross AND net per hole, stroke dot in the box.
- #613 — `/week` league night breaks a tie with the same last-nine countback the
  leaderboard/`/live` use (was breaking net ties on gross).
- #614 — `recordSettlement` is idempotent against a double-tap (was logging a
  payment twice).

**In flight:** #615 — landing uplift (honest value-framed comparison band, the
missing Season tier, and an Ultimate "Let's talk" tier). Merge SHA-pinned on
green + confirm deploy.

**Parked on branches (NOT merged; `main`/production untouched):**
- `claude/captain-team-selection` — captains pick their own flight's team from
  availability (Phase 1 WIP). See `docs/` / the captain spec section below.
- `claude/logo-mobile-color` — logo refresh (green disc, bigger, no hole, black
  stick, white ball). Finishing it needs the favicon/PWA/iOS/Android icon set
  regenerated (`scripts/gen-icons.mjs`).

**Documented, deliberately deferred (need care / a deal / prod data):**
- Corporate / multi-club membership — see `docs/corporate-membership.md`. No
  engine; the Ultimate tier is a contact tier.
- Concurrency hardening (see `docs/audit-round-4-findings.md` §6–10): #6
  duplicate-entry unique index (needs prod dedup first), #7 capacity/tier
  over-cap TOCTOU, #8 scorecard-conflict version column, #10 tee-sheet lost
  update. #9 (settlement idempotency) is done (#614).
- `/me/money` settled-skins-subset finality: #611 shipped the Nassau half; the
  skins-subset case needs `stakeFor` taught to exclude an already-settled pot to
  avoid double-counting exposure.

**Open product decisions (the user's, not to build unprompted):** shared-places
vs tiebreak-resolved place; Pro/Association tiers beyond Club; whether launching
a tournament gates player access.

## Key product decisions (already made — do not re-litigate)

- **Pricing:** Free $0 (10 players) / Season $49 (50) / Club $175 (unlimited),
  owner-adjustable from `/owner`; field size is the value metric, a player never
  pays. Plus an Ultimate "Let's talk" tier (associations/corporates) — a contact
  tier, no engine. Real competitor facts (verified 2026-09): Golf Genius
  ~$1,300/yr + $200–500 setup, no free tier; GolfStatus nonprofit-gated; BlueGolf
  quote-only. **We are NOT categorically cheaper — never claim "half the price".**
- **Brand:** TourneyHQ first on every screen, fixed orange/green, never
  club-coloured. Tagline "From Registration to Recognition." The player app uses
  the fixed scoreboard-green ground (design D), the exception to club theming.
- **Player side is read-only** (score + sign up); captains are a flight setting,
  not an auth role. The money tool records, never moves.
- **Casual rounds** are the free-tier product, distinct from tournaments.
- Marketing/comparisons must use **real, verifiable competitor facts** and must
  not name competitors on the landing (describe them).

## Dominant bug classes to watch (this codebase's recurring failures)

- **A screen answering the wrong question** — an absence reported as a fact, or a
  ranking on the wrong figure. Pin two readers of one question to AGREE; enforce
  a rule at the sink (one reader), never a guard a caller must remember.
- **Wrong result table** — four exist: `Scorecard` (stroke), `TeamScorecard`
  (team), `Match` (match play AND Nassau), `BracketWinner` (knockout). Reading
  the wrong one reports empty over a full round.
- **Constant-offset errors** (e.g. a round scored against the wrong course's par)
  are invisible to order/count tests — assert to-par / a point / a skin, and
  check one row against the Rules, not against the other rows.
- Combination/edge states (no rounds, one player, a cut, withdrawals, shared-ball
  rounds, league opt-outs) are where bugs live — the `matrix.test.ts` sweep and
  the `scripts/verify-*.mjs` route/state walks exist for this.

## Bootstrapping a fresh session

1. Read `CLAUDE.md` (hard rules, the gate, the CI flakes, the shell traps).
2. Read this file and the `docs/` it references.
3. `git log --oneline -15` and `gh pr list` for the live state; check parked
   branches (`git branch -a | grep claude/`).
4. Confirm what's actually on `main` before trusting "merged":
   `git show origin/main:<file> | grep <symbol>`.
