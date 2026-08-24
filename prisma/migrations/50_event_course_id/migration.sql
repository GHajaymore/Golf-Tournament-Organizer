-- The tournament's own venue, as an id rather than a name.
--
-- `Event.course` is a NAME and was the only venue this model had; it predates
-- the Course library, and resolveCourse still matches on it. Every other venue
-- in the app -- a round's, a match's -- is an id, so the tournament's own was
-- the last thing picked by typing a string.
--
-- Written by hand rather than generated: `prisma migrate dev` wants a shadow
-- database and failed replaying an earlier migration into one. CLAUDE.md is
-- explicit that drift is fixed by hand rather than by anything that would drop
-- the development database, which holds real data.
--
-- IDEMPOTENT ON PURPOSE -- see the note in 48_course_catalog_country. This was
-- first pushed under a timestamped folder name that sorted before the
-- migrations it depends on; renaming the folder means a deploy re-runs this
-- file, and every statement below tolerates that.
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "courseId" TEXT;

CREATE INDEX IF NOT EXISTS "Event_courseId_idx" ON "Event"("courseId");

-- SetNull, not Cascade: deleting a course must never delete a tournament,
-- exactly as it does not delete a round played on it.
--
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so the catalogue is asked
-- directly. Adding it twice would fail the whole migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Event_courseId_fkey'
  ) THEN
    ALTER TABLE "Event"
      ADD CONSTRAINT "Event_courseId_fkey"
      FOREIGN KEY ("courseId") REFERENCES "Course"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill from the name every existing tournament already carries.
--
-- Only where the club has EXACTLY ONE course of that name. Two courses sharing
-- a name is precisely the ambiguity that made a name a bad key, and guessing
-- between them here would point a tournament at the wrong card silently --
-- which is the failure this column exists to end, not one to commit on the way
-- in. Those events keep courseId NULL and go on resolving by name as before.
--
-- Idempotent by its WHERE clause: it only touches rows that still have no id.
UPDATE "Event" e
SET "courseId" = (
  SELECT c."id" FROM "Course" c
  WHERE c."organizationId" = e."organizationId"
    AND c."name" = e."course"
  LIMIT 1
)
WHERE e."courseId" IS NULL
  AND e."course" <> ''
  AND (
    SELECT COUNT(*) FROM "Course" c2
    WHERE c2."organizationId" = e."organizationId"
      AND c2."name" = e."course"
  ) = 1;
