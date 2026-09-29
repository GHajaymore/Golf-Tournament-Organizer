-- A team cup: points to win outright (0 = more than half) and the holder who keeps it on a tie.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "cupHolderGroupId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "cupPointsToWin" DOUBLE PRECISION NOT NULL DEFAULT 0;
