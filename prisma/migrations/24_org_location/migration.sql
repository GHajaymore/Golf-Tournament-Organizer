-- Where the club is.
--
-- Nothing anchored "courses near us": the app knew a club by name alone, so
-- there was no region to search and no default city when adding a course.
-- Empty defaults, so no existing club changes.
ALTER TABLE "Organization" ADD COLUMN "city" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Organization" ADD COLUMN "region" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Organization" ADD COLUMN "country" TEXT NOT NULL DEFAULT '';
