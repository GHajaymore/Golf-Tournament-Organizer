-- OLD SETTING-UP ROWS KEEP THEIR WORD (state machine PR 8, J14; proposal of 3 Nov, section 4).
--
-- A045, not A042-A044: those numbers are held by other open branches (already applied to
-- the development database). Nothing here depends on them.
--
-- Since 31 Oct (G1) a tournament before launch has ONE step, Setting up, stored as `draft`.
-- No app action has written `registration` or `ready` since #976 (`statusMove` refuses it),
-- but rows from before then still hold them. This moves each to `draft` and keeps its old
-- value, verbatim, in a new column, so:
--   * nothing is lost: the old word is in "legacyStatus";
--   * nothing members could see disappears: `openToMembers` reads "legacyStatus" where it
--     read the two legacy statuses;
--   * the public sign-up ("registrationOpen", "registrationToken") is not touched;
--   * the A036 name index ("Event_name_in_play_key", WHERE status IN ('draft','registration',
--     'ready','live')) holds the old AND the new value, so no row newly clashes or leaves it.
--
-- ONLY "status" IS NAMED. "playerCountMode" also holds the word 'registration' (its default);
-- it is another column and is not touched. No 'live' or 'completed' row is touched.
--
-- SAFE TO RUN TWICE: the column is added IF NOT EXISTS, and the UPDATE matches only rows
-- still holding a legacy status, of which a second run finds none.
--
-- A ROW MID-UPDATE: the UPDATE takes each matching row's lock. A concurrent transaction that
-- commits a change of status first (a launch, to 'live') is seen by the UPDATE's re-check
-- (READ COMMITTED), which then skips the row; one that comes second waits for this one and
-- then writes its own status over 'draft', leaving the old word in "legacyStatus", where it
-- changes nothing (a launched tournament is open to members anyway). The ADD COLUMN with a
-- constant default is a catalogue change (PostgreSQL 11+): it rewrites no rows and holds its
-- lock only for an instant.
--
-- Hand-written from `prisma migrate diff --from-schema-datasource ... --to-schema-datamodel
-- ... --script` (read-only), keeping only this change; no DROP DEFAULT rode along.
--
-- AND THE DATABASE REFUSES ANY OTHER STATUS FROM HERE (QA Director's test plan, risk 1). From
-- this PR `isLaunched` is "not `draft`", so a row written in an old word by a missed fixture, a
-- script or a raw insert would read as LAUNCHED: setup locked, no Launch button, open to members.
-- "Event_status_is_one_the_app_writes" refuses the WRITER, so that row cannot exist.
--
-- ANY OTHER WORD IS MAPPED FIRST, SO THE DEPLOY CANNOT FAIL ON ONE (Ajay, 14 Nov: everything in
-- production is test data, so the only real risk here is a deploy that fails partway, P3009).
-- Before the CHECK, every row whose status is not draft, live or completed (an "active" from an
-- old fixture, a "complete", a word in capitals or with a space) is mapped by ONE rule:
--   * it becomes what the code before this migration READ it as. `isLaunched` was "not draft,
--     registration or ready" and `isFinished` was "exactly completed", so any other word read as
--     launched and unfinished: LIVE;
--   * EXCEPT where 'live' would put it into the A036 name index ("Event_name_in_play_key": one
--     club, one normalised name, status draft/registration/ready/live, shape not match) beside a
--     row already there, or beside an earlier stray (lower id) of the same name. That row becomes
--     COMPLETED instead: also launched, outside the index, so the unique index can never refuse
--     this UPDATE. The CASE reads the table as it was before the statement, so it is decided the
--     same way however the rows are visited;
--   * its old word is kept verbatim in "legacyStatus", so nothing is lost.
-- After that no row holds another status, so the CHECK always goes on. It is still GUARDED, like
-- A036 (a NOTICE, never a failed deploy) in case a row appears between the two statements. With
-- this rule no production status count is needed before the merge.
--
-- ROLLBACK, IN THIS ORDER. (1) Roll the CODE back first (Vercel instant rollback to the previous
-- production deployment); that is the default rollback and usually all of it: the old code runs
-- on the new schema (the column has a default; the old code writes no status the CHECK refuses).
-- The new code would read a restored 'registration' as LAUNCHED, so never run SQL first. (2) Only
-- to give members back the moved rows under the old code, run the reversal below with the
-- owner's tools (never from a runner). (3) After its DROP COLUMN, delete A045's row from
-- "_prisma_migrations", or the next deploy of main skips A045 and every query selecting
-- "legacyStatus" fails. If A045 FAILS mid-deploy, Prisma records it (P3009) and refuses every
-- later deploy until `prisma migrate resolve --rolled-back A045_old_setting_up_rows_keep_their_word`
-- is run against production by the owner; this file is safe to run again, so the re-deploy works.
-- The reversal touches only rows still 'draft': a moved row launched since keeps its status.
-- Rows mapped from another word keep live or completed, which the old code reads the same way.
--
-- Reversal (not applied; kept here as the pull request asks):
--   ALTER TABLE "Event" DROP CONSTRAINT IF EXISTS "Event_status_is_one_the_app_writes";
--   UPDATE "Event" SET "status" = "legacyStatus", "legacyStatus" = '' WHERE "legacyStatus" <> '' AND "status" = 'draft';
--   ALTER TABLE "Event" DROP COLUMN "legacyStatus";

ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "legacyStatus" TEXT NOT NULL DEFAULT '';

UPDATE "Event"
   SET "legacyStatus" = "status", "status" = 'draft'
 WHERE "status" IN ('registration', 'ready');

-- Any other word: LIVE (what the old code read it as), or COMPLETED where live would share a name
-- in play with another row of its club (see "ANY OTHER WORD" above). Old word kept verbatim.
UPDATE "Event" AS e
   SET "legacyStatus" = e."status",
       "status" = CASE
         WHEN e."shape" <> 'match' AND EXISTS (
           SELECT 1 FROM "Event" AS o
            WHERE o."id" <> e."id"
              AND o."organizationId" = e."organizationId"
              AND o."shape" <> 'match'
              AND lower(btrim(regexp_replace(o."name", '\s+', ' ', 'g'))) = lower(btrim(regexp_replace(e."name", '\s+', ' ', 'g')))
              AND (o."status" IN ('draft', 'registration', 'ready', 'live')
                   OR (o."status" NOT IN ('draft', 'live', 'completed') AND o."id" COLLATE "C" < e."id" COLLATE "C"))
         ) THEN 'completed'
         ELSE 'live'
       END
 WHERE e."status" NOT IN ('draft', 'live', 'completed');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Event_status_is_one_the_app_writes' AND conrelid = '"Event"'::regclass
  ) THEN
    NULL;
  ELSIF EXISTS (SELECT 1 FROM "Event" WHERE "status" NOT IN ('draft', 'live', 'completed')) THEN
    RAISE NOTICE 'Event_status_is_one_the_app_writes not added: a row holds a status other than draft, live or completed';
  ELSE
    ALTER TABLE "Event" ADD CONSTRAINT "Event_status_is_one_the_app_writes"
      CHECK ("status" IN ('draft', 'live', 'completed'));
  END IF;
END $$;
