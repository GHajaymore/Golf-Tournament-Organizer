# Handoff

Written 2026-08-07. Read this first, then `git log` for detail.

## Where things stand

- Branch `build/production-app`, **pushed**, and **CI is green** — including the
  first-ever `next build` and a full migration replay onto an empty database.
- 910 tests pass, `tsc --noEmit` clean, ESLint zero errors (2 advisory warnings).
- Migration folders are zero-padded (they replayed lexicographically before —
  0, 1, 10, 11 … — and died at 15_org_theme on any fresh database).
  `scripts/pad-migration-names.mjs` renames applied rows on existing databases
  and runs before `migrate deploy` in vercel-build, so production heals itself
  on its next deploy. Do not rename migration folders again without the same
  two-sided treatment.
- Players can only write their own scores (assertOwnMatch/assertOwnCard in
  actions/tournament.ts, linked by registration email); the entry screen
  filters with the same rule.
- Next feature in queue: net-per-hole score import (deterministic — gross =
  net + strokes received; the server knows the Playing Handicap per round).
  Points-only and totals-only imports are deliberately refused: neither can be
  inverted to real hole scores, and the importer never manufactures golf that
  wasn't played.

## Environment traps

These have each cost real time. They are not hypothetical.

1. **`next build` and `next dev` share `.next`.** Building while the dev server is
   running corrupts it. Stop the server first.
2. **`src/lib/db.ts` caches PrismaClient on `globalThis`.** After any schema change
   the dev server *must be restarted* — hot reload cannot replace it. Symptom is
   `PrismaClientValidationError` naming a column that exists in the database and in
   the generated client.
3. **Bash heredocs and `node -e`**: escapes get mangled. Use `<<'EOF'`, and when a
   line is already damaged, rebuild it with a regex rather than trying to match the
   mangled bytes.
4. **PowerShell** `WriteAllLines` converts LF→CRLF and `Add-Content -Encoding utf8`
   mangles UTF-8. Both have silently broken source files here.
5. Bash needs `PATH="/c/Program Files/nodejs:$PATH"`.

## How to look at the UI

`/styleguide` is dev-only, needs no login and no database. It renders the real
components with the real CSS: scorecard, hole picker, entry modes, match rows,
and the bulk importer with its column spec.

Everything else sits behind the login. `/entry` additionally requires the event to
have a course card.

**Look at the screen before changing it.** The single largest source of wasted work
in the previous session was redesigning from imagination when the browser tools
reach `localhost:3100` perfectly well.

## Open work, in priority order

1. **Push** — turns on CI, verifies the build.
2. **Security review of the server actions added on 2026-08-07**: `importScores`,
   `clearRoundScores`, `setStageCutScope`, `setStageDeadlineOverride`,
   `saveOrganizationBranding`. Written scoped, never audited as a set. Every
   `"use server"` export is a public HTTP endpoint regardless of what calls it.
3. **Playwright** — there are no end-to-end browser tests. Their absence is why a
   restyle shipped having missed three of its four surfaces.
4. **`src/lib/domain/attest.ts` is an orphan** — engine and tests, no consumer.
   Wiring it into `savePlayMatchHoles` also fixes a live gap: that guard tests
   `playerAId`/`playerBId`, so a partner in a four-ball is wrongly refused.
5. **Theme reset button.** Default is the `sunset` preset (orange) with `fairway`
   secondary. Must also clear `themeHex`, or a stale custom colour resurrects the
   next time someone picks "custom".
6. **Palette mismatch warning.** Recommendation: warn, do not block. Contrast is
   already safe by construction — the engine fixes lightness and takes only hue and
   saturation from a chosen colour. "Mismatch" is a taste judgement, and blocking a
   club from its own colours is worse than a soft note.
7. **Winners record.** Denormalized table, **no foreign key to Event**:
   `Player.event` is `onDelete: Cascade`, so anything derived from it dies when a
   tournament is purged. Store the tournament name as text. Cup badge beside the
   name. Overall winners only to start — five flight cups per event is decoration.
8. **Member history** — current/played counts, plus "member since" (needs a new
   column; `Member` has no `createdAt`).

Longer-standing: merge Scorecards into Tee sheet, OCR card scan (needs a vision
API key; validator and review flow already built), Resend for password-reset email,
canonical production domain.

## Decisions already made — please don't reopen without reason

- The fictional course presets were **deliberately deleted**. Real cards arrive by
  paste or import. Removing them is what left `CourseSetupPrompt` broken for a
  while; it now offers the club's own saved courses first.
- Entry options are **format-scoped from the engine's own rule** (`entryModesFor`)
  and are **visible, not hidden behind a link**. Hiding them was tried and rejected
  by the user.
- For scoring scope, **the match beats the foursome**: two pairs sharing a tee time
  never approve each other's cards. See `domain/attest.ts`.
- The Qualification nav item is **gated on a knockout stage existing**.
- Score entry is **four surfaces**, not one: `ScoreEntryClient` (hole results and
  scorecard modes), `StrokePlayEntry`, `TeamEntryClient`. A change to one is a
  change to none of the others.

## Known-good invariants worth keeping

- `prisma/migrations/migration_lock.toml` must exist and say `postgresql`. It was
  missing (lost in the SQLite→Postgres move) and `prisma migrate diff` fails
  outright without it.
- The clone-policy test forces every new `Event` column to be classified as
  inherited or reset. If it fails after a schema change, that is by design.
- `DEFAULT_SETTINGS` is pinned by a test so a new setting cannot slip in unnoticed.
