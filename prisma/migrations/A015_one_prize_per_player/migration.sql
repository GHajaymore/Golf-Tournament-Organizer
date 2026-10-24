-- ONE PRIZE PER PLAYER (Ajay, 2026-10-21, recommendation C1).
--
-- The tournament's tick-box, off for every tournament that exists, so nothing
-- already stored changes.
ALTER TABLE "Event" ADD COLUMN "onePrizePerPlayer" BOOLEAN NOT NULL DEFAULT false;

-- Each prize line says whether it is a PLACING prize, which counts under the
-- rule. Lines count by default.
--
-- NO BACKFILL, deliberately. Marking the existing "Nearest the pin" and
-- "Longest drive" lines as skill prizes would be a write to every tournament's
-- prize rows, real clubs' included (CLAUDE.md hard rule 1), for a value nobody
-- reads while the rule is off everywhere. A club that ticks the rule sees each
-- line's switch on Prizes and sets it there.
ALTER TABLE "Prize" ADD COLUMN "countsForOnePrize" BOOLEAN NOT NULL DEFAULT true;
