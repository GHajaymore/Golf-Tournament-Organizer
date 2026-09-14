-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "teeId" TEXT;

-- AlterTable
ALTER TABLE "Stage" ADD COLUMN     "teeId" TEXT;

-- AddForeignKey
ALTER TABLE "Stage" ADD CONSTRAINT "Stage_teeId_fkey" FOREIGN KEY ("teeId") REFERENCES "Tee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_teeId_fkey" FOREIGN KEY ("teeId") REFERENCES "Tee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
