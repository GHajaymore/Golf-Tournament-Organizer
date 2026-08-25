# TourneyHQ — Golf Tournament Organizer

[![CI](https://github.com/GHajaymore/Golf-Tournament-Organizer/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/GHajaymore/Golf-Tournament-Organizer/actions/workflows/ci.yml?query=branch%3Amain)

*From tee to trophy.*

Production build of the golf tournament management console described in
[`design_handoff_golf_tournament_console/`](./design_handoff_golf_tournament_console).
A console for running a multi-stage golf event end to end: registration →
flights → round-robin/stroke rounds → qualification → brackets → live standings.

Built with **Next.js (App Router) + TypeScript**, **Prisma + SQLite**, a pure
(dependency-free, unit-tested) **tournament engine**, and the **design system**
(`src/app/design-system.css`) ported verbatim from the handoff.

## Quick start

```bash
npm install
npm run db:push      # create the SQLite schema
npm run db:seed      # load the Demo Cup pilot (32 players, 8 groups)
npm run dev          # http://localhost:3000
```

Sign-in is real email + password (`src/app/actions/auth.ts`), not a demo
picker. From a fresh seed:

- **alex@demogolf.test** — organizer, pre-provisioned but with no password
  set yet, so the landing page will walk you through the "claim your account
  with a password" flow the first time.
- Anyone with no existing account anywhere can self-serve **create a brand
  new tournament** straight from the landing page.
- Forgot a password? "Forgot password?" on the sign-in step emails a
  15-minute one-time reset link via [Resend](https://resend.com) — set
  `RESEND_API_KEY` in `.env` to actually send it; without a key the link is
  logged to the server console instead so local dev still works end to end.

Organizers can preview the player view with the "Viewing as" switch in the
sidebar, and switch between every tournament their email has access to from
`/choose`.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Run the tournament-engine unit tests (Vitest) |
| `npm run typecheck` | `tsc --noEmit` across the app |
| `npm run db:push` | Push the Prisma schema to the database |
| `npm run db:seed` | Seed the Demo Cup pilot data |
| `npm run db:reset` | Reset + reseed |
| `npm run db:studio` | Open Prisma Studio |

## Architecture

```
src/
  lib/domain/         Pure tournament engine — no framework/DB deps, fully unit-tested
    match.ts            match-play resolution from holes[] (3&2 / AS / N UP)
    standings.ts        aggregation, configurable tiebreaker chain, ranking, cutoff
    grouping.ts         snake-draft group formation
    schedule.ts         round-robin schedule (circle method)
    bracket.ts          8-seed bracket seeding [1,8,4,5,3,6,2,7] + advancement
    carry.ts            stage carry-forward
  lib/db.ts           Prisma client singleton
  lib/auth.ts         Signed-cookie sessions, scrypt password hashing, role model
  lib/courses.ts      Built-in course presets + resolveCourse/hasCourseData (custom courses)
  lib/email.ts        Resend wrapper (password reset emails; logs the link if unconfigured)
  lib/services/       Server read model (loadEventState) + regroup service
  app/                Next.js App Router — one route per screen
    (app)/…             authenticated console (sidebar shell)
    actions/            server actions (mutations)
    reset-password/     public route for the emailed reset link
  components/         Client components for the interactive screens
prisma/
  schema.prisma       Data model (Event, Account, User, Player, Group, Stage, Match,
                       Scorecard, MatchScorecard, PasswordResetToken, …)
  seed.ts             Demo Cup seed
```

**Standings are always derived**, never stored: every screen recomputes from the
match `holes[]` data through `src/lib/domain`, exactly as the handoff specifies.
The same engine powers the seed script, so demo data matches production behavior.

## Screens

Landing/sign-in/signup/forgot-password · Tournament picker (`/choose`) ·
Dashboard · Event setup · Registration & field · Rounds & format · Flights &
divisions · Access & staff · Tee sheet & pairings · Scorecards · Score entry
(hole-by-hole tap, gross scorecard with automatic net-of-handicap match-play
scoring, match-result entry, and voice dictation for all three) · Qualification ·
Bracket manager · Announcements · Prizes & payouts · Live leaderboard ·
Reports/export.

## Roles

- **Organizer (admin)** — full access to every screen, including Access &
  staff and Event setup.
- **Assistant** — operational screens (registration, rounds, entry, etc.),
  not the admin-only ones.
- **Player** — Dashboard, Live leaderboard, and Score entry only.

Enforced server-side in `src/lib/auth.ts` / `page-helpers.ts` (`PLAYER_SCREENS`,
`ADMIN_ONLY_SCREENS`), not just hidden in the nav. One `User` (one email, one
password) can hold an `Account` — and therefore a role — on any number of
events; `/choose` lists every event a signed-in email has access to.

## Production notes / next steps

- **Database**: switch `datasource.provider` in `prisma/schema.prisma` to
  `postgresql` and set `DATABASE_URL`. No app code changes — all access goes
  through the repository/service layer.
- **Auth**: the cookie-session module is a self-contained stand-in for the pilot.
  Swap it for Auth.js/OAuth without touching callers (`getSession()` contract).
- **Email**: password reset needs `RESEND_API_KEY` (and ideally a verified
  sending domain via `RESEND_FROM_EMAIL`) in production — see `src/lib/email.ts`.
- **Realtime**: the live leaderboard/score entry currently refresh on navigation +
  server-action revalidation. Add websockets/Server-Sent Events for cross-device
  live updates on the course.
- **Voice**: uses the browser Web Speech API; evaluate a hosted STT service for
  noisy outdoor conditions.
- **Multi-course events**: a course (par/yards/stroke index) is scoped to the
  whole `Event`, not per-round or per-match. A month-long round robin played
  across multiple clubs would need that moved onto `Stage` (or `Match`) —
  not yet scoped.
- **Mobile builds**: Capacitor (iOS/Android) shells live under `ios/`,
  `android/` — see their READMEs. `.github/workflows/ios-testflight.yml` and
  `android-release.yml` build and ship to TestFlight/Play Console from
  GitHub-hosted runners (no local Mac needed); both need App Store
  Connect/Play Console setup and several secrets first — see the comments at
  the top of each workflow file. Neither has run against real credentials
  yet, so expect to iterate once real CI logs are available.
- **Desktop builds**: Electron scaffolding lives under `electron/`
  (`npm run electron:build`); a signed download link for it is still open.

See [`design_handoff_golf_tournament_console/README.md`](./design_handoff_golf_tournament_console/README.md)
for the full domain spec this build implements.

---

An AjAi Labs creation.
