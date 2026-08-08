-- Tournaments with no fixed course.
--
-- "fixed" for every existing row: they were all created when a single venue
-- was the only option, and defaulting them to "open" would start asking their
-- organizers where each match was played.
ALTER TABLE "Event" ADD COLUMN "courseMode" TEXT NOT NULL DEFAULT 'fixed';

-- Somewhere to keep the address of a course added on the day, so the next
-- person looking for it has more than a name.
ALTER TABLE "Course" ADD COLUMN "address" TEXT NOT NULL DEFAULT '';
