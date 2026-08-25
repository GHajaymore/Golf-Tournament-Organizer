-- A flight's tees.
--
-- A club championship is one tournament with three divisions off three sets:
-- the championship off the blues, the seniors off the whites, the ladies off
-- the reds. Per-player assignment can express that, but only as 120 separate
-- decisions -- so in practice it would not be used, and the field would be
-- scored off one set that two thirds of it never played.
--
-- Nullable, and NULL means the flight makes no claim: the round's tees, which
-- is exactly how every existing flight already behaves.
ALTER TABLE "Group" ADD COLUMN IF NOT EXISTS "teeId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Group_teeId_fkey') THEN
    ALTER TABLE "Group"
      ADD CONSTRAINT "Group_teeId_fkey"
      FOREIGN KEY ("teeId") REFERENCES "Tee"("id") ON DELETE SET NULL;
  END IF;
END $$;
