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
-- "Event_status_is_one_the_app_writes" refuses the WRITER, so that row cannot exist. It is added
-- AFTER the move and GUARDED, like A036: only where no row holds any other status, so a database
-- with a status nobody expected (an "active" from an old fixture) is never failed mid-deploy —
-- there it is left out with a NOTICE, the moved rows are moved all the same, and the app's own
-- refusal (`statusMove`) still stands. Ops counts production's statuses before the merge; once a
-- stray is resolved, run this file again by hand (`prisma db execute --file`): every part of it
-- is safe to run twice.
--
-- Reversal (not applied; kept here as the pull request asks):
--   ALTER TABLE "Event" DROP CONSTRAINT IF EXISTS "Event_status_is_one_the_app_writes";
--   UPDATE "Event" SET "status" = "legacyStatus", "legacyStatus" = '' WHERE "legacyStatus" <> '';
--   ALTER TABLE "Event" DROP COLUMN "legacyStatus";

ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "legacyStatus" TEXT NOT NULL DEFAULT '';

UPDATE "Event"
   SET "legacyStatus" = "status", "status" = 'draft'
 WHERE "status" IN ('registration', 'ready');

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
