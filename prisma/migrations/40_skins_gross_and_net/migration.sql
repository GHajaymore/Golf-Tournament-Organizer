-- A round may run BOTH a gross and a net skins pot.
--
-- Clubs commonly run the two together on a league night: gross for the low
-- handicaps, net so everybody has a chance. They are separate games with
-- separate entrants and separate money, so one pot per round was wrong.
--
-- The unique key moves from the round to the round-and-scoring pair. Nothing
-- to backfill: no pot has more than one row per round today, so every existing
-- row already satisfies the new key.
--
-- carryInCents is retired. A week settles on its own — the pot goes out to
-- whoever won a hole that night, and the players square up before they leave.
-- Carrying money forward would ask this week's field to play for stake money
-- put in by people who are not there. The column is dropped rather than left
-- unread, so nothing can quietly start using it again.
DROP INDEX "SkinsPot_stageId_key";
CREATE UNIQUE INDEX "SkinsPot_stageId_net_key" ON "SkinsPot"("stageId", "net");

ALTER TABLE "SkinsPot" DROP COLUMN "carryInCents";
