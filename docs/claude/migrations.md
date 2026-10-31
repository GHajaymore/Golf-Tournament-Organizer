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
