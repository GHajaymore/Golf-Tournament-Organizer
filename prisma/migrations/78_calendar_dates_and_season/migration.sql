-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "endOn" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "startOn" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "seasonStartsOn" TEXT NOT NULL DEFAULT '';
