-- A contest's sponsor, as a record and a thank-you (2026-10-17). Additive: two columns
ALTER TABLE "Contest" ADD COLUMN "sponsorName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Contest" ADD COLUMN "sponsorUrl" TEXT NOT NULL DEFAULT '';
