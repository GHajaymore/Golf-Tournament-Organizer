-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "stageId" TEXT;

-- CreateIndex
CREATE INDEX "Group_eventId_stageId_idx" ON "Group"("eventId", "stageId");

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
