-- AlterTable
ALTER TABLE "Scorecard" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "certifiedAt" TIMESTAMP(3),
ADD COLUMN     "certifiedBy" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'entered';
