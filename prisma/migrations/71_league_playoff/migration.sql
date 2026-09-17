-- How many clubs go through to a league's play-offs: 0, 2, 4 or 8.
--
-- Zero is no play-off, which is every tournament that exists today. Otherwise
-- the last one, two or three team rounds are the play-off rounds — final,
-- semi-finals, quarter-finals — and the league table counts only the rounds
-- before them. Which rounds they are is derived from this number rather than
-- marked on each round, so adding a week to the season cannot leave a
-- play-off flag on the wrong one.
ALTER TABLE "Event" ADD COLUMN "leaguePlayoffClubs" INTEGER NOT NULL DEFAULT 0;
