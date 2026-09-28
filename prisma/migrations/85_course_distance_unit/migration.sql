-- What a course's distances are measured in: "yards", "metres", or "" for not
-- set (src/lib/domain/distance-unit.ts decides what empty means: a directory
-- card is yards, anything else follows the club's country). Ajay's decision 15,
-- 2026-09-28.
--
-- Additive, with an empty default that MEANS "follow the rule" -- the same shape
-- as golfTerms -- so no existing row is rewritten and nothing is backfilled.
-- The numbers themselves are never converted.

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "distanceUnit" TEXT NOT NULL DEFAULT '';
