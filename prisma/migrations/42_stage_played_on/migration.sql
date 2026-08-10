-- The day a round is actually played, as an ISO date ("2026-05-19").
--
-- Distinct from deadline: a Tuesday league PLAYS on Tuesday, it does not
-- "play by" Tuesday. Stored as a calendar day rather than a timestamp so a
-- club never sees Monday for a round everyone played on Tuesday.
--
-- Empty for every existing round, which is exactly how they behave today.
ALTER TABLE "Stage" ADD COLUMN "playedOn" TEXT NOT NULL DEFAULT '';
