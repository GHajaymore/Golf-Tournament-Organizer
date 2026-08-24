-- Where a catalogued course is in the world.
--
-- The directory only sets `state` on US courses, so a course outside the US
-- arrives with two blank location fields and cannot be told from any other
-- course of the same name.
--
-- WRITTEN IDEMPOTENTLY, ON PURPOSE. This migration was first pushed with a
-- timestamped folder name, which sorts BEFORE `45_course_catalog` — the
-- migration that creates the table it alters ('2' < '4'), so replaying the
-- chain into an empty database failed and CI was red for two days. Renaming
-- the folder fixes the order, but the old name is already recorded as applied
-- in every database that has it, so a deploy sees the new name as pending and
-- re-runs this file. Guarded, that is a harmless no-op instead of
-- "column already exists" and a broken deploy. Do not "tidy" the guards away.
ALTER TABLE "CourseCatalog" ADD COLUMN IF NOT EXISTS "country" TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS "CourseCatalog_country_idx" ON "CourseCatalog"("country");
