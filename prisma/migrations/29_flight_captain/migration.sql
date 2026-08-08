-- The flight's captain, appointed by the organizer.
--
-- Appointed, never inferred: team-member order is ability order (foursomes
-- alternation, scramble allowances), and reading authority into position
-- one would crown the wrong person. A captain sees their own flight's
-- attendance list and nobody else's; losing the player clears the
-- captaincy rather than blocking the removal.
ALTER TABLE "Group" ADD COLUMN "captainId" TEXT;
ALTER TABLE "Group" ADD CONSTRAINT "Group_captainId_fkey"
  FOREIGN KEY ("captainId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;
