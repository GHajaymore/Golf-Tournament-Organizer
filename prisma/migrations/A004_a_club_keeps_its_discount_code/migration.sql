-- The discount code a club gave at sign-up, kept for its plan checkout (2026-10-17).
-- Empty for every existing club: none of them gave one.
ALTER TABLE "Organization" ADD COLUMN "discountCode" TEXT NOT NULL DEFAULT '';
