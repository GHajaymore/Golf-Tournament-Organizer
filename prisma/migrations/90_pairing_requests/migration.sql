-- Pairing requests: the players in the same event an entrant asked to be drawn with.

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "playWith" TEXT[] DEFAULT ARRAY[]::TEXT[];
