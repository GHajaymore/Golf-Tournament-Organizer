-- A knockout's rounds each have a "play by" date (the panel, 2026-10-23): the
-- secretary sets them on the Bracket screen and every round heading, the "To
-- play" list and a player's own tie show them. JSON, rounds counted back from the
-- final to an ISO day; empty for none, so every existing round keeps exactly what
-- it shows today. Adds a column with a default: safe on an empty table and on a
-- populated one.
ALTER TABLE "Stage" ADD COLUMN "knockoutPlayBy" TEXT NOT NULL DEFAULT '';
