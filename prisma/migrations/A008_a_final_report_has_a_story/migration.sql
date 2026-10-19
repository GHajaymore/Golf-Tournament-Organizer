-- The final report's story, as the organizer wrote it (2026-10-19). Additive:
-- one column, empty for every tournament, which then tells its story from the
-- results alone.
ALTER TABLE "Event" ADD COLUMN "reportRecap" TEXT NOT NULL DEFAULT '';
