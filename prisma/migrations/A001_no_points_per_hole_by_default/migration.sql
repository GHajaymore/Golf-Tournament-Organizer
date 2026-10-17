-- A new tournament awards no points per hole won (2026-10-16).
--
-- Ajay agreed, on the review panel's advice: 0.5 a hole is not a standard term,
-- and it counts holes won in the points total and again in the hole-difference
-- tiebreak. Existing tournaments keep the figure they have; only the default moves.
ALTER TABLE "Event" ALTER COLUMN "holeRatioPts" SET DEFAULT 0;
