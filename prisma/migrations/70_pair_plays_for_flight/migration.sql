-- A weekly pair plays for a FLIGHT, not for another team.
--
-- `Team.parentTeamId` pointed at a stage-less Team standing in for the club.
-- That was a parallel model: a Group already IS the club side of a league —
-- it is named, it belongs to the tournament rather than a round, its roster is
-- Player.groupId, and it carries an optional captain and vice-captain that the
-- organizer appoints in flights setup. `setFlightCaptain` already refuses
-- anybody who is not a member of the flight.
--
-- So the club is a flight, and this points at it. Nothing in production has a
-- parent yet — the column was added hours ago and no UI writes it — so there
-- is nothing to migrate.
ALTER TABLE "Team" DROP CONSTRAINT IF EXISTS "Team_parentTeamId_fkey";
DROP INDEX IF EXISTS "Team_parentTeamId_idx";
ALTER TABLE "Team" DROP COLUMN IF EXISTS "parentTeamId";

ALTER TABLE "Team" ADD COLUMN "clubGroupId" TEXT;

ALTER TABLE "Team" ADD CONSTRAINT "Team_clubGroupId_fkey"
  FOREIGN KEY ("clubGroupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Team_clubGroupId_idx" ON "Team"("clubGroupId");
