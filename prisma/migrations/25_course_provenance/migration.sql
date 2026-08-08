-- Whether a course card was typed in by the club or pulled off the web.
--
-- Existing cards default to 'manual': every one of them was entered by hand,
-- so calling them anything else would be inventing a doubt that isn't there.
-- verifiedAt stays null — unchecked is the honest starting point, and the
-- screen offers to confirm rather than assuming.
ALTER TABLE "Course" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Course" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "Course" ADD COLUMN "verifiedBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Course" ADD COLUMN "sourceUrl" TEXT NOT NULL DEFAULT '';
