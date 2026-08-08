-- The club's own course.
--
-- A golf club plays at its course — every tournament, unless someone says
-- otherwise. Setting it once on the organization spares the organizer picking
-- a venue they were never going to change, and new tournaments start with it
-- as their only venue, which keeps every course picker hidden.
--
-- Null for societies and community organizations: they have no home course,
-- and several venues is their normal case rather than an exception. A club is
-- not locked in either — it can add an away venue to any tournament, for a
-- member-guest played elsewhere.

ALTER TABLE "Organization" ADD COLUMN "defaultCourseId" TEXT;

-- SET NULL rather than CASCADE: deleting a course from the library must not
-- delete the club. The home course simply becomes unset.
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_defaultCourseId_fkey"
    FOREIGN KEY ("defaultCourseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;
