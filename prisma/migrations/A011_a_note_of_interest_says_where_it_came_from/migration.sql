-- Where a note of interest came from (2026-10-21): the campaign tags of the
-- link they arrived by, read from the URL. Additive.
ALTER TABLE "InterestRequest" ADD COLUMN "source" TEXT NOT NULL DEFAULT '';
