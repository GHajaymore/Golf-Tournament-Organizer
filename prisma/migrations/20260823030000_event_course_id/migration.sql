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
ALTER TABLE "Event" ADD COLUMN "courseId" TEXT;

CREATE INDEX "Event_courseId_idx" ON "Event"("courseId");

-- SetNull, not Cascade: deleting a course must never delete a tournament,
-- exactly as it does not delete a round played on it.
ALTER TABLE "Event"
  ADD CONSTRAINT "Event_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill from the name every existing tournament already carries.
--
-- Only where the club has EXACTLY ONE course of that name. Two courses sharing
-- a name is precisely the ambiguity that made a name a bad key, and guessing
-- between them here would point a tournament at the wrong card silently --
-- which is the failure this column exists to end, not one to commit on the way
-- in. Those events keep courseId NULL and go on resolving by name as before.
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
