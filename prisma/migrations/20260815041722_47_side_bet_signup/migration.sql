-- AlterTable
ALTER TABLE "ContestEntry" ADD COLUMN     "confirmed" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "SideGameEntry" ADD COLUMN     "confirmed" BOOLEAN NOT NULL DEFAULT true;
