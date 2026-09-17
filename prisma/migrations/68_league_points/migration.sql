-- How an interclub league turns four-ball results into points.
--
-- On the EVENT, not the round: a league scores every week the same way, and a
-- setting that could differ round to round is a league whose table cannot be
-- added up.
--
-- Empty means "not a league", which is every tournament that exists today, so
-- nothing changes for any of them. The systems themselves are named in
-- domain/league-meeting.ts.
ALTER TABLE "Event" ADD COLUMN "leaguePoints" TEXT NOT NULL DEFAULT '';

-- What the match is worth on top of the holes, where the system has a bonus.
-- Clubs differ, so it is a number rather than a constant.
ALTER TABLE "Event" ADD COLUMN "leagueMatchBonus" INTEGER NOT NULL DEFAULT 2;
