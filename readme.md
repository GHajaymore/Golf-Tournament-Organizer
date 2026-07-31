# Fairway — Golf Tournament Organizer

Production build of the golf tournament management console described in
[`design_handoff_golf_tournament_console/`](./design_handoff_golf_tournament_console).
An admin console for running a multi-stage match-play event end to end:
registration → grouping → round-robin → qualification → brackets → live standings.

Built with **Next.js (App Router) + TypeScript**, **Prisma + SQLite**, a pure
(dependency-free, unit-tested) **tournament engine**, and the **Nocturne** design
system ported verbatim from the handoff.

## Quick start

```bash
npm install
npm run db:push      # create the SQLite schema
npm run db:seed      # load the Nocturne Cup pilot (32 players, 8 groups)
npm run dev          # http://localhost:3000
```

Sign in by picking an account on the landing page — **Alex Rourke** (Organizer,
full access) or **Marcus Webb** (Player, read-only + own score entry). Organizers
can preview the player view with the "Viewing as" switch in the sidebar.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Run the tournament-engine unit tests (Vitest) |
| `npm run typecheck` | `tsc --noEmit` across the app |
| `npm run db:push` | Push the Prisma schema to the database |
| `npm run db:seed` | Seed the Nocturne Cup pilot data |
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
  lib/auth.ts         Signed-cookie sessions + role model
  lib/services/       Server read model (loadEventState) + regroup service
  app/                Next.js App Router — one route per screen
    (app)/…             authenticated console (sidebar shell)
    actions/            server actions (mutations)
  components/         Client components for the interactive screens
prisma/
  schema.prisma       Data model (Event, Account, Player, Group, Stage, Match, …)
  seed.ts             Nocturne Cup seed
```

**Standings are always derived**, never stored: every screen recomputes from the
match `holes[]` data through `src/lib/domain`, exactly as the handoff specifies.
The same engine powers the seed script, so demo data matches production behavior.

## Screens (all 16 from the handoff)

Login/event-selection · Dashboard · Event setup · Registration · Player roster ·
Grouping rules · Access control · Stage builder · Round robin · Scoring rules ·
Qualification · Bracket manager · Scorecard generator · Score entry (hole-by-hole,
match-result, and voice dictation) · Live leaderboard · Reports/export.

## Roles

- **Organizer/Admin** — full access to every screen.
- **Player** — Dashboard, Live leaderboard, and Score entry only. Enforced
  server-side in `src/lib/auth.ts` / `page-helpers.ts`, not just hidden in the nav.

## Production notes / next steps

- **Database**: switch `datasource.provider` in `prisma/schema.prisma` to
  `postgresql` and set `DATABASE_URL`. No app code changes — all access goes
  through the repository/service layer.
- **Auth**: the cookie-session module is a self-contained stand-in for the pilot.
  Swap it for Auth.js/OAuth without touching callers (`getSession()` contract).
- **Realtime**: the live leaderboard/score entry currently refresh on navigation +
  server-action revalidation. Add websockets/Server-Sent Events for cross-device
  live updates on the course.
- **Voice**: uses the browser Web Speech API; evaluate a hosted STT service for
  noisy outdoor conditions.
- **Stubs called out in the UI**: PDF exports (bracket sheet, scorecards) and
  tiebreaker drag-reordering are intentionally marked as not-yet-wired.

See [`design_handoff_golf_tournament_console/README.md`](./design_handoff_golf_tournament_console/README.md)
for the full domain spec this build implements.
