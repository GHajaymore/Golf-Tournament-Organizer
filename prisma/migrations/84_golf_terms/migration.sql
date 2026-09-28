-- Which golf the app speaks to a club: "us", "uk", or "" to follow its country
-- (src/lib/domain/golf-terms.ts). Ajay, 2026-09-27: "local by default and
-- overridden option for USD and US terminologies".
--
-- Additive, with an empty default that MEANS "follow the country" -- the same
-- shape as communityNoun -- so no existing row is given an opinion it did not
-- express and nothing needs backfilling.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "golfTerms" TEXT NOT NULL DEFAULT '';
