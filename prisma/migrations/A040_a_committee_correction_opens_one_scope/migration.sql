-- A COMMITTEE CORRECTION OPENS ONE SCOPE (state machine PR 5b, 2026-11-07; TD Q2, panel 8.1).
--
-- A040, not A039: `A039_an_entry_says_member_or_guest` is another branch's, already
-- applied to the development database. Nothing here depends on it.
--
-- The blanket "Unlock configuration" leaves the app. In its place the Organizer
-- opens ONE lock scope for a stated reason, recorded in Recent changes, until
-- Done or the end of the club's day. These four columns hold the one open
-- correction; all four null means none is open.
--
-- Additive only, every column nullable, no default to drop: an existing row is
-- untouched and reads as "no correction open". `configUnlocked` is NOT changed
-- here — a production event that is live today with the blanket unlock on keeps
-- it (Ops, 8.5), and the app goes on reading it as the legacy correction until
-- PR 9. Ops counts those rows first with `node scripts/count-unlocked-events.mjs`.
--
-- Hand-written from `prisma migrate diff --from-schema-datasource … --to-schema-datamodel … --script`
-- (read-only), keeping only this change. IF NOT EXISTS so a database that ran
-- this under another name keeps it.
--
-- Reversal (not applied; kept here as the pull request asks):
--   ALTER TABLE "Event" DROP COLUMN "correctionScope", DROP COLUMN "correctionReason",
--     DROP COLUMN "correctionBy", DROP COLUMN "correctionUntil";

ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "correctionScope" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "correctionReason" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "correctionBy" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "correctionUntil" TIMESTAMP(3);
