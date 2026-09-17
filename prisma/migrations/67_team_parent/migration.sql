-- A pair that plays for a club team.
--
-- A `Team` in this app is the SIDE that plays a round, capped at four players.
-- An interclub league has a second level above that: twelve club teams with a
-- roster of ten or more, each nominating six pairs a week, every pair playing
-- a four-ball against an opposing pair.
--
-- Nullable and defaulted to NULL, so every team that exists today is unchanged
-- and every format that does not have a parent keeps working untouched.
--
-- ON DELETE SET NULL rather than CASCADE: deleting a club team must not delete
-- the weekly pairs, because those pairs hold the matches and the scorecards of
-- rounds that were actually played. The league would lose its season.
ALTER TABLE "Team" ADD COLUMN "parentTeamId" TEXT;

ALTER TABLE "Team" ADD CONSTRAINT "Team_parentTeamId_fkey"
  FOREIGN KEY ("parentTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Team_parentTeamId_idx" ON "Team"("parentTeamId");
