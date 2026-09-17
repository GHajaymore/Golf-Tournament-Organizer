-- A COMMITTEE DECISION, on top of the play-off hole.
--
-- Migration 72 recorded who won a level meeting on the play-off hole. This
-- allows the other case Ajay asked for: overturning a meeting somebody WON —
-- a disqualification, an appeal, a side that turned out to be ineligible.
--
-- Two columns rather than a second table, because it is the same fact with a
-- different cause: who goes through, and why.
--
--   overrode  true when the recorded winner is not the club the points gave it
--             to. The screens say so, to members as well as staff, because a
--             bracket that silently disagrees with the scores is worse than
--             the result it is hiding.
--   note      the committee's reason, required for an override and shown
--             wherever the override is.
ALTER TABLE "LeaguePlayoffHole" ADD COLUMN "overrode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeaguePlayoffHole" ADD COLUMN "note" TEXT NOT NULL DEFAULT '';
