-- The vice-captain deputises: same read-only view of their flight's weekly
-- list, same appointment-not-inference rule as the captaincy.
ALTER TABLE "Group" ADD COLUMN "viceCaptainId" TEXT;
ALTER TABLE "Group" ADD CONSTRAINT "Group_viceCaptainId_fkey"
  FOREIGN KEY ("viceCaptainId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;
