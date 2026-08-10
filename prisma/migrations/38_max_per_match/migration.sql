-- The most a player or side can take from any single match.
--
-- Holes won feed into points, so a 7&6 pays several times what a 1-up win
-- pays, and a flight can be settled by one thrashing before the last match is
-- played. Capping the take keeps a flight live to the end, which is why it is
-- standard in member-guest invitationals.
--
-- Zero is no cap, and zero is the default, so every existing tournament keeps
-- scoring exactly as it does today.
ALTER TABLE "Event" ADD COLUMN "maxPerMatch" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- And the club-level house default that seeds it on a new tournament. Copied
-- at creation, never pointed at: a club that changes its house rule next month
-- must not silently rewrite an event already being played.
ALTER TABLE "Organization" ADD COLUMN "defaultMaxPerMatch" DOUBLE PRECISION NOT NULL DEFAULT 0;
