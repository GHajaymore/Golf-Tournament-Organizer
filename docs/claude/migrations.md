# Migrations

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: any Prisma schema change. Index: `CLAUDE.md`.

## Migrations

`schema.prisma` splits the datasource: `url` is the pooled connection, `directUrl` the direct
one. Migrations need the direct URL — advisory locks and DDL cannot cross a pooler.

Before creating a migration, read the SQL it generated. Prisma emits everything it considers
drift, so an unrelated `DROP DEFAULT` can ride along with a one-line change. If that happens,
fix the *schema* so it matches the database rather than accepting the drop.

**NAME A NEW MIGRATION `A001_…`, `A002_…` — never `100_` and never Prisma's timestamp.** A fresh
database (CI makes one on every run) replays the folders in TEXT order. Two digits ran out at
`99_`, and `100_` sorts before `10_`; a timestamp name sorts between `19_` and `20_`, where 26
of them already sit from August and September — history, which replays there and works, and
is left as it is. A capital letter sorts after every digit, so `A000` to `A999` replay after all
of it, then `B000`. `migrations-replay-in-the-order-written.test.ts` refuses anything else. When
`prisma migrate dev --create-only` names one by timestamp, rename the folder before applying it.

**A new model means restarting the dev server, not just recompiling.** A running Next process
holds the generated client in memory, so `prisma.yourNewModel` stays `undefined` however many
times the page hot-reloads — and the screen fails with `Cannot read properties of undefined
(reading 'findMany')`, which reads like a bug in the query rather than a stale process. It
happened twice on 2026-08-22, to `courseCatalog` and then `honoursEntry`. It never reproduces
in production, because a deploy is always a fresh build.

So after `prisma migrate deploy`: `npx prisma generate`, then stop and restart the dev server
before believing anything the browser tells you.

**There is ONE generated client for every worktree (2026-11-07).** `.claude/settings.json` links each
worktree's `node_modules` to the main checkout's, so `node_modules/.prisma/client` is shared. On 6-7 Nov
an engineer ran `prisma generate` from a branch adding `Event.correctionScope`, and three other engineers'
tsc and audit runs failed with "The column Event.correctionScope does not exist" — which reads like their
own bug. The guard hook (`.claude/hooks/guard.mjs`, `sharedClientRefusal`) now refuses `prisma generate`
and `npm run db:generate` in a worktree whose `prisma/schema.prisma` differs from the main checkout's;
from the main checkout itself it is allowed (that is the repair). So a branch with a schema change does
not generate: `node scripts/prisma-client-check.mjs` (read-only) says whose schema the shared client
holds, the engineer's report says the client is stale for the new columns, and the main session
regenerates from main after the merge and restarts the dev server. `PRISMA_SHARED_CLIENT_OK=1` in front
of the command overrides, only when nobody else is mid-run. A true per-worktree client would need a copy
of `@prisma/client` and `.prisma/client` in each worktree (Node resolves the real path of a symlink) —
heavier than the problem, and not done.

**An index Prisma cannot express lives in SQL alone (2026-11-01).** `A036_a_name_in_play_is_the_clubs_once`
makes `Event_name_in_play_key`, a partial unique index on an expression (one name in play per club;
the rule is `domain/tournament-name.ts`). It is not in `schema.prisma`, only a comment beside
`Event`'s indexes. Measured: CI's `prisma migrate diff --from-migrations … --to-schema-datamodel …
--exit-code` says "No difference detected" with it in place, so the drift check stays green. If a
migration Prisma GENERATES later carries `DROP INDEX "Event_name_in_play_key"`, delete that line
before applying it. It is GUARDED: a `DO $$ … $$` block that creates it only where no club already
holds two in-play tournaments of one name, so production's real events are never renamed or
blocked; where it was skipped the app's own check still holds, and its SQL can be run again by
hand with `prisma db execute --file` (it is idempotent) once the clubs have resolved their duplicates. Check whether it exists
with `select indexname from pg_indexes where indexname = 'Event_name_in_play_key'`.

**A CHECK Prisma cannot express, the same way (state machine PR 8, 2026-11-13).**
`A045_old_setting_up_rows_keep_their_word` moved every `Event` stored as `registration` or `ready` to
`draft`, keeping the old word in `Event.legacyStatus` (read by `openToMembers`), and then adds
`Event_status_is_one_the_app_writes`: `CHECK ("status" IN ('draft', 'live', 'completed'))`. From then on
`isLaunched` is "not `draft`", so a row written in any other word would read as LAUNCHED; the CHECK
refuses the writer. It is not in `schema.prisma` (a comment beside `status` says so), and it is GUARDED
like A036 — added only where no row holds another status, a NOTICE otherwise, every statement safe to
run twice. So a fixture, seed or audit test that writes an invented status (`"active"`, `"complete"`
were found in twelve audit files and moved to `"live"`) now fails at the insert, loudly. Check it with
`select pg_get_constraintdef(oid) from pg_constraint where conname = 'Event_status_is_one_the_app_writes'`.
The proof is `a-legacy-row-keeps-its-word.audit.test.ts`, which runs the file's own text against a
scratch copy of a zz- club's rows.
