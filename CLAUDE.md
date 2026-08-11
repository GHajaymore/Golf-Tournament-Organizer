# TourneyHQ

Golf tournament management. Next.js 15 (App Router) · React 19 · TypeScript · Prisma 6 · PostgreSQL.
Deployed on Vercel. Also packaged for iOS/Android via Capacitor and desktop via Electron.

## Hard rules

These are not preferences. Breaking one has consequences that cannot be undone from here.

1. **Never modify, seed into, or test against the "2026 CDG Matchplay Championship" event.**
   It holds real member names and email addresses. Read it if you must; never write to it.
2. **The GitHub repository is public.** No player PII — names, emails, phone numbers, scores
   tied to real people — may ever be committed. That includes fixtures, test data, screenshots
   and pasted logs.
3. **`main` auto-deploys to production via Vercel.** Do not push to it without saying so first.
4. **Commit with explicit paths.** Never `git add -A`; an untracked scratch file with real data
   is exactly how rule 2 gets broken.
5. **Never `git stash`** — this working tree is shared.
6. **Never `prisma migrate reset`** or any command that drops the development database. It holds
   the CDG data. If Prisma demands a reset, fix the drift by hand instead (see Migrations).
7. **TourneyHQ calculates and records money. It never moves money.** Skins, payouts and prize
   splits are arithmetic and a record. No payment rails, no transfers.

## Test fixtures

Use a throwaway organization and event, prefix every row with a mark (`zz-<purpose>`), invented
names, and `@example.invalid` addresses. Delete them in a `finally` — a fixture left in the
database is a fixture someone will later mistake for real.

## Verification

Run before committing anything non-trivial:

```bash
npx tsc --noEmit && npx vitest run && npx next lint && NEXT_DIST_DIR=.next-ci npx next build
```

`npm run smoke` GETs every route against a running dev server and fails on a 5xx. It exists
because neither tsc nor the unit tests render a server component — a screen can throw on every
request with a clean build and 1300 green tests.

Use `NEXT_DIST_DIR=.next-ci` for builds while a dev server is running; sharing `.next` between
them corrupts it.

## What the tests enforce

The suite is not only about behaviour — several files exist to make a whole class of mistake
impossible. Extend these rather than working around them.

- `audit-idor.test.ts` — every server action checks authorization.
- `themes.test.ts` — every accent ramp and neutral ramp clears its contrast floor on both
  grounds, and stays monotonic.
- `brand-consistency.test.ts` — the logo is drawn once, at a size from `LOGO_SIZE`.
- `score-payload.ts` — scoring payloads are validated at the boundary. **TypeScript types are
  erased at runtime**; a `"use server"` export is a public HTTP endpoint and will be called with
  whatever the caller likes.

## Migrations

`schema.prisma` splits the datasource: `url` is the pooled connection, `directUrl` the direct
one. Migrations need the direct URL — advisory locks and DDL cannot cross a pooler.

Before creating a migration, read the SQL it generated. Prisma emits everything it considers
drift, so an unrelated `DROP DEFAULT` can ride along with a one-line change. If that happens,
fix the *schema* so it matches the database rather than accepting the drop.

## Design

- Two grounds, one set of tokens: `DARK_GROUND` and `LIGHT_GROUND` in `src/lib/themes.ts`.
  Components read `--color-*` custom properties and never hard-code a colour.
- The ramp reverses between grounds, so low steps are always foreground and high steps always
  background, whichever ground you are on.
- **Outdoor legibility is a product requirement, not a nicety.** Scores are read on a phone in
  direct sun. `SUNLIGHT_RATIO` is 7:1 on the dark ground. Player-facing surfaces use
  `playerThemeCss`, which resolves `auto` light-first — the console uses `themeCss`, which
  resolves it dark-first.
- Grid and flex children need `min-width: 0` to be allowed to shrink; `minmax(0, 1fr)`
  constrains the track, not the item. Anything wide (tables, scorecards) gets its own
  `overflow-x: auto` wrapper, so the page body never scrolls sideways.

## Shell

Windows. Both PowerShell and Git Bash are available and take different syntax — do not mix them
(a PowerShell here-string in bash silently becomes part of the string). Node needs
`PATH="/c/Program Files/nodejs:$PATH"` under Git Bash.
