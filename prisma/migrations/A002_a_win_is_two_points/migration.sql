-- A new tournament's match-play table: a win is 2, a halve 1, a loss 0 (2026-10-16).
--
-- Ajay's ruling: a halve is worth half a win, the usual league table, with
-- nothing per hole won (A001). Existing tournaments keep the points they have.
ALTER TABLE "Event" ALTER COLUMN "winPts" SET DEFAULT 2;
