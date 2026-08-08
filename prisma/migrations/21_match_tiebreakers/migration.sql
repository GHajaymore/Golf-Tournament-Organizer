-- How an all-square match is decided.
--
-- Empty string means "leave it halved", which is correct match play and
-- exactly what every existing tournament does today. No result changes.
ALTER TABLE "Event" ADD COLUMN "matchTiebreakers" TEXT NOT NULL DEFAULT '';
