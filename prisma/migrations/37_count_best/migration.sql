-- How many partners' scores count on each hole, for aggregate formats.
--
-- Four-ball and best ball count the single best score. Many club and society
-- days count the best two or three of four instead, so nobody is a spectator
-- once one player has made par.
--
-- Additive, and zero by default. Zero means "count what the format counts" —
-- one — so every existing round scores exactly as it did before.
ALTER TABLE "Stage" ADD COLUMN "countBest" INTEGER NOT NULL DEFAULT 0;
