-- The tees a tournament is played from.
--
-- Every scoring path used `tees[0]?.id` -- whichever set happened to sort
-- first by position. A club whose first tee is Blue scored every unassigned
-- player off Blue even when the medal was off the Whites, and nothing on any
-- screen said so. A wrong tee is a wrong Course Handicap, which is strokes
-- on the wrong holes.
--
-- Nullable, and NULL keeps the old behaviour exactly: fall back to the first
-- tee. So a tournament already running is unchanged until somebody sets it.
--
-- Tees are per TOURNAMENT, not per club: the same course is played off
-- different sets by different competitions, and a house default would be
-- wrong as often as it was right.
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "defaultTeeId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Event_defaultTeeId_fkey'
  ) THEN
    ALTER TABLE "Event"
      ADD CONSTRAINT "Event_defaultTeeId_fkey"
      FOREIGN KEY ("defaultTeeId") REFERENCES "Tee"("id") ON DELETE SET NULL;
  END IF;
END $$;
