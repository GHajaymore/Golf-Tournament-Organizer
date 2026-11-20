# Restore drill: Tuesday 17 November 2026

Owner: Operations Lead. Goal: prove a production backup can be restored, into a **throwaway** database,
and that the restored data is complete. A backup nobody has restored is a hope, not a backup.

**The drill never writes to production, and never restores into the development database
(`localhost/tourneyhq_dev`) or the preview database.** Production holds real people (Hard rule 1). The
restored copy also holds real people: it is private data, kept off GitHub, off screenshots, and deleted at the end (Hard rule 2).

## Where backups come from

What the code and docs show:
- **Production** is Prisma Postgres, reached through Vercel's Storage integration (`docs/release-strategy.md`;
  `docs/handover-2026-08-19.md`; the 2026-09-08 error in `docs/claude/deploy-history.md` names `db.prisma.io`).
  The connection strings are marked Sensitive in Vercel and are viewed under Storage, the database, **Show secret**.
- **Preview** is a separate database on Neon (`tourneyhq-preview`). **Development** is local Postgres.
- The schema has a pooled `url` (`PRISMA_DATABASE_URL`) and a direct `directUrl` (`DATABASE_URL`) (`prisma/schema.prisma`).
  Dumps and restores use the **direct** one.
- **Nothing in the repository says how production backups are taken, how often, how long they are kept,
  or how to restore one.** `scripts/load/README.md` mentions "a production backup" only as an input to a load test.

**To confirm (before 17 Nov, with the Prisma / Vercel dashboard):**
1. Does the production database's plan include automatic backups or point-in-time recovery? How often, how long kept?
2. How is a backup restored: into a **new** database from the console, or only by support request?
3. Who has the right to start a restore and to view the connection string?
4. Is there a read-only database role for taking counts from production? (If not, the drill uses a plain
   `SELECT` with the least-privileged string available, and the Operations Lead writes down whose it was.)

## Choose the route (Operations Lead decides on 16 Nov, once the answers above are in)

- **Route A (preferred): the provider's own backup, restored into a new database.** Tests the backups we
  would really use in an emergency.
- **Route B (if A does not exist or cannot be done into a new database): our own dump.** `pg_dump` of
  production over the direct connection with a read-only role, restored with `pg_restore` / `psql`. This tests
  the procedure and the data, not the provider's backups, and the report says so.

## Where the throwaway lives

A **new empty database** made for the drill and named so nobody mistakes it: `zz-restore-drill-2026-11-17`,
on a provider project that is not production, not `tourneyhq-preview`, and not the development database
(for example a new Neon project, or a fresh database on the Operations Lead's local Postgres). It is deleted at
the end of the day. If it must be local, use a laptop with disk encryption, and delete the dump file too.

## Guard rails (read these aloud before starting)

1. Put the throwaway's connection string in an environment variable called `RESTORE_DRILL_URL`, set in the
   shell for this session only. **Never** name it `DATABASE_URL` or `PRISMA_DATABASE_URL`, never write it
   to `.env`, and never run a `prisma` command: this drill needs none, and Prisma reads those two names.
2. Before every command that writes, print the host of the target and say it aloud:
   `psql "$RESTORE_DRILL_URL" -Atc "select current_database(), inet_server_addr()"`. The database name must be
   `zz-restore-drill-2026-11-17` or the drill's agreed name. Anything else: stop.
3. The production string is used **only** with `SELECT` (counts) and, on Route B, `pg_dump`. It is never an
   argument to `psql -f`, `pg_restore`, or `prisma`. Use a different shell window for production, labelled.
4. Do not run the drill while a pilot club is in a live round: the dump and the counts read production and
   add load. A Tuesday with no event on is the intent; check with the Organizer first.
5. Do not write the connection strings, a dump, or a result containing names anywhere in this repository,
   a screenshot, a chat or a ticket.

## Steps

1. **Fix the backup point.** Route A: choose the newest backup (or a restore time) and write down its
   timestamp (UTC). Route B: write down the dump's start time.
2. **Take the "source" counts from production first** (read-only; `<PROD_URL_READONLY>` is the direct string):
   ```sql
   select 'User' t, count(*) from "User" union all
   select 'Organization', count(*) from "Organization" union all
   select 'Event', count(*) from "Event" union all
   select 'Player', count(*) from "Player" union all
   select 'Stage', count(*) from "Stage" union all
   select 'Scorecard', count(*) from "Scorecard" union all
   select 'MatchScorecard', count(*) from "MatchScorecard" union all
   select 'TeamScorecard', count(*) from "TeamScorecard" union all
   select 'AuditLog', count(*) from "AuditLog" union all
   select 'migrations', count(*) from "_prisma_migrations" union all
   select 'foreign keys', count(*) from pg_constraint where contype = 'f' union all
   select 'indexes', count(*) from pg_indexes where schemaname = 'public';
   select max("createdAt") as newest_user from "User";
   ```
   Save the output with the time it was taken. (Table names equal the model names in `prisma/schema.prisma`; there are no `@@map`s.)
3. **Restore.** Route A: use the provider's restore into a **new** database; then take its connection
   string into `RESTORE_DRILL_URL`. Route B: `pg_dump --no-owner --no-privileges -Fc` from production to a file,
   then `pg_restore --no-owner --no-privileges -d "$RESTORE_DRILL_URL" <file>` (guard rail 2 first). Record how
   long each took and how large the dump was.
4. **Take the same counts from the restored database** with the same query, using `RESTORE_DRILL_URL`.
5. **Compare** (next section) and look at the structure checks below.
6. **Clean up.** Delete the throwaway database (Route A: delete the restored database or branch at the
   provider), delete the dump file, clear the shell variables, and confirm in the provider's console that
   it no longer exists. Record that it was done.

## How to prove the restore is good

The source is the production database's own counts from step 2, taken **read-only**.

- **Route B, taken on a quiet day:** every count must be **equal**. Take the production counts again
  immediately after the dump finishes; if they changed, someone wrote in between: the dump point and the
  counts do not belong together, so repeat the dump rather than explain the difference.
- **Route A (a backup older than now):** the restored counts must be **less than or equal to** production's,
  for the tables that only grow (`Scorecard`, `AuditLog`, `User`), and the gap must be explained by activity
  after the backup's timestamp. Compare `max("createdAt")` on `User` with the backup's timestamp.
- **Structure:** `migrations`, `foreign keys` and `indexes` must be **equal** in both, and the
  `Event_name_in_play_key` index must exist in the restored copy iff it does in production
  (`select 1 from pg_indexes where indexname = 'Event_name_in_play_key'`; it is deliberately created only
  where no club had a clash, `docs/claude/migrations.md`).
- **Sanity:** the newest row of `AuditLog` is close to the backup timestamp, and no table that has rows in
  production is empty in the copy.

Pass = every comparison above holds. A single mismatch is a **fail** until explained and repeated.

## What to record (in the incident log, not as names in the repository)

Date, who ran it, route used, backup timestamp and age, time to restore and size, the two count tables
side by side with their query times, each comparison pass or fail, anything surprising, how long cleanup took
and proof the throwaway is gone, and the **recovery figures this gives us**: "a backup this old was
restored in this long". Then update `runbook.md` with the real restore steps for the provider and the answers
to the four questions above. If the drill cannot be done (no restorable backup), that is the finding:
tell the Owner the same day, because it means a lost database cannot be recovered.

## To confirm

The four questions under "Where backups come from", and: where the Operations Lead keeps the drill record;
and whether the Owner wants a second drill after the first real event.
