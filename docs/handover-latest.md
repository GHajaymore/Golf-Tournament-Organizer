# Handover — latest (2026-09-25)

The single file to open when picking this project up in a new session (any model, or a
different AI). It restates the essentials so nothing lives only in a chat. The deeper detail is
in `CLAUDE.md`, `docs/PROJECT-CONTEXT.md`, `docs/handoff-2026-09-25.md`, and
`docs/deferred-register.md`; a Claude Code session also auto-loads `MEMORY.md`.

## Who / what

TourneyHQ — golf tournament management. Next.js 15 (App Router), React 19, TypeScript,
Prisma 6, PostgreSQL. Deployed on Vercel (`main` → tourneyhq.club); also packaged for
iOS/Android (Capacitor) and desktop (Electron). It **calculates and records** money
(skins/payouts/splits) but **never moves** money.

**Standing mode (Ajay, the owner — a golf-club pro):** make the app perfect, clean,
launch-ready. Pick the work, ship it, merge on green (SHA-pinned), keep going continuously;
don't wait unless you truly need a decision. Honesty binds — report what actually happened;
never fake a marketing claim.

## Read first, in order

1. `CLAUDE.md` — hard rules, the full verification gate, and a long field guide to the CI flakes.
2. `docs/PROJECT-CONTEXT.md` — cross-AI project overview.
3. `docs/handoff-2026-09-25.md` — the full prior-session record.
4. `docs/deferred-register.md` — everything deliberately not built, and why.
5. `docs/test-run-novice.md` — the novice test-run playbook (see task 1).

In Claude Code, `MEMORY.md` auto-loads; read especially `testing-session-2026-09-25`,
`capacity-race-fixed`, `pricing-tiers-decided`, `walk-real-screens-with-playwright`, and
`club-calendar-build-plan`.

## Environment gotchas (each costs an hour if unknown)

- **The Bash tool on this Windows machine is broken** (it dumps `declare -x` env vars). Use
  PowerShell for shell and the Read/Grep/Glob/Edit tools for files. In PowerShell prepend
  `$env:PATH="C:\Program Files\nodejs;$env:PATH"`.
- **Never write a source file through PowerShell** — round-trips corrupt em-dashes/curly quotes
  into mojibake, invisibly. Use Edit/Write. Anything with a backslash goes through Edit/Write,
  never a heredoc or `node -e`. For git commit messages / PR bodies, **write to a temp file and
  use `git commit -F` / `gh pr create --body-file`** (inline here-strings break on apostrophes).
- **Dev DB only** (`localhost/tourneyhq_dev`). Ajay says existing/prod data is disposable and the
  app "isn't live" — but nothing you do needs to touch prod (all testing runs on the dev DB), so
  do **not** wipe production on standing permission; confirm per specific deletion. Never
  `prisma migrate reset` (replays migrations on an empty DB — a prod-only migration-bug trap).
- **The full gate**, before committing anything non-trivial:
  ```
  npx tsc --noEmit && npx vitest run && npx next lint && NEXT_DIST_DIR=.next-ci npx next build
  ```
  plus `npx vitest run --config vitest.audit.config.ts` for money/handicap/authz/intake, and
  `npm run smoke:all` for route/content. **Mutation-verify every new test** (break it, watch it
  go red, restore).
- **Merges are SHA-pinned** (a green PR is not a green commit):
  ```
  head=$(gh pr view <PR> --json headRefOid -q .headRefOid)
  gh pr merge <PR> --squash --match-head-commit $head
  ```
  Then confirm the **Deploy to production** job on the main **push** run (the PR run's deploy is
  always "skipped"). Known flakes — re-run the same commit (`gh run rerun <id> --failed`), do NOT
  edit app code: Chromium SEGV in `organizer.spec` desktop (signal 11 `SEGV_MAPERR 0000000001b0`);
  React "Client Manifest" miss (the component name is noise); `next/font` fetch fail;
  `offline.spec:245` scroll race.

## Prices (authoritative, from `src/lib/plans.ts`; ten-month annual = 10× monthly)

Free $0 · Season $49/mo → $490/yr · Club $175/mo → $1,750/yr. Owner-adjustable from `/owner`;
enforcement **off** by default. **Never claim "half of Golf Genius"** — it is false (Golf Genius
≈ $1,300/yr). Lead the price story on: no setup fee (GG charges $200–500), a real free tier (GG
has none), published pricing (enterprise tools are quote-only). Competitors are described, never
named.

## Current state (end of 2026-09-25 session)

- **Live in production:** #617 (capacity over-cap race fix — `withEventIntakeLock`, a per-event
  `pg_advisory_xact_lock` on both sign-up paths) and #618 (landing: a "Make it yours"
  customizations section, three new FAQ items, and removal of a false price comment in
  `plans.ts`).
- **#619** (`docs/test-run-novice.md`) merged; its production deploy was completing at handover
  (desktop e2e still running, no flake).
- Full suite **green**: `tsc`, unit 8639, audit 1348, lint, build, `smoke:all` (7 scripts).
  Landing verified live in the browser.
- The **seeded demo club is loaded** in the dev DB (11 tournaments spanning all 16 formats incl.
  a "Festival of Formats"). Re-seed / get cookies with `node --env-file=.env scripts/seed-club.mjs`;
  `--teardown` to remove.

## First tasks, in order

1. **The novice-organizer permutation walk.** Walk the app as an organizer with little golf
   knowledge, across every format × audience, judging **navigation and UX**. Use
   `docs/test-run-novice.md`. Authenticated organizer/player screens need **Playwright MCP** with
   the signed cookie on the browser **context** — the in-app browser pane cannot hold the session
   (`document.cookie` doesn't stick; `/me` redirects to sign-in). Public `/live/<token>` boards
   need no cookie and work in-pane. Walk the already-seeded tournaments as the club secretary
   (admin on every event) rather than creating each. Report findings: blocking / confusing /
   wrong / rough.
2. **Open finding — confirm and fix test-first; do NOT blindly change ranking (money-adjacent).**
   On `/live` boards, players at equal displayed net to-par can number e.g. 9, 9, 11, 12 when one
   is in-progress ("thru 11"). This is largely the intended rule —
   `board-ranks-comparable-scores.audit.test.ts` pins *"a live board ranks play, not progress"*
   (comparison on common holes). The only genuinely open bit is **display**: the console renders a
   shared rank as `T9` (`positionLabel` in `src/lib/domain/scoreboard.ts`) while `/live` printed
   bare `9`. Check what `/live`'s row component actually renders; if it drops the tie prefix, fix
   that with a test. Leave the countback / comparable-holes ranking alone.
3. **Remaining concurrency** (lower priority, more care): #6 duplicate self-entry (needs a
   `(eventId,email)` unique index + a prod dedup pass first — #617's lock does **not** close it);
   the organizer bulk-add lock (`addFromRoster` in `src/app/actions/roster.ts`); #8 scorecard save
   race; #10 tee-sheet.

## Do-not-re-raise (locked decisions)

Net skins pay on the **playing** handicap; Stableford ranked on points; the player app uses the
fixed scoreboard theme; brand = TourneyHQ-first, fixed orange/green (even white-label), tagline
"From Registration to Recognition"; pricing capped at Club (Pro/Association parked); logo refresh
parked (cosmetics later, branch `claude/logo-mobile-color`); **no corporate/multi-club engine
exists** (Organization is flat; the Ultimate tier is a "Let's talk" contact card); the **club
calendar is built** (`/me/calendar`) — do not rebuild.
