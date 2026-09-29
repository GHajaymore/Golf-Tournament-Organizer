-- A round's pin sheet (hole positions, JSON) and its time allowed (0 = club default).

-- AlterTable
ALTER TABLE "Stage" ADD COLUMN     "paceMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pinSheet" TEXT NOT NULL DEFAULT '';
