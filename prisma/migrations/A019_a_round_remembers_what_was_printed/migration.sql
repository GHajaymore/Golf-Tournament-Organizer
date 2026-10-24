-- The Print kit's record of what it sent to the printer for a round
-- (2026-10-23): one JSON object, keyed by sheet, with a fingerprint of what
-- was on each sheet, its version and when. See lib/domain/print-kit.ts.
-- Empty for every round that existed before it: nothing printed yet.
ALTER TABLE "Stage" ADD COLUMN "printLog" TEXT NOT NULL DEFAULT '';
