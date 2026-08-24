-- AlterTable
ALTER TABLE "CourseCatalog" ADD COLUMN     "country" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "CourseCatalog_country_idx" ON "CourseCatalog"("country");
