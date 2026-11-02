-- The Print kit's record of what it sent to the printer for a round
-- (2026-10-23): one JSON object, keyed by sheet, with a fingerprint of what
-- was on each sheet, its version and when. See lib/domain/print-kit.ts.
-- Empty for every round that existed before it: nothing printed yet.
-- IF NOT EXISTS (2026-10-31): renamed from A019 so it replays after A030; a
-- database that already ran it under the old name keeps its column.
ALTER TABLE "Stage" ADD COLUMN IF NOT EXISTS "printLog" TEXT NOT NULL DEFAULT '';
