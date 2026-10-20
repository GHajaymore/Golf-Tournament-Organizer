-- A phone number on a note of interest, optional (2026-10-21). Additive.
ALTER TABLE "InterestRequest" ADD COLUMN "phone" TEXT NOT NULL DEFAULT '';
