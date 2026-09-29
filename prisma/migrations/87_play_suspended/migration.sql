-- Play suspended by the organizer (Rule 5.7). Null while play is on.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "playSuspendedAt" TIMESTAMP(3),
ADD COLUMN     "playSuspendedNote" TEXT NOT NULL DEFAULT '';
