-- How a tie for the last place at a stroke cut is settled, and the committee's
-- record of the ties it settled by hand. Additive; every existing round keeps
-- "ties", which sends everybody level on the last score through.
ALTER TABLE "Stage" ADD COLUMN "cutTies" TEXT NOT NULL DEFAULT 'ties';
ALTER TABLE "Stage" ADD COLUMN "cutTieDecisions" TEXT NOT NULL DEFAULT '[]';
