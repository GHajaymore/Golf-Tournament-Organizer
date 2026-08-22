-- CreateTable
CREATE TABLE "CourseCatalog" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "par" INTEGER NOT NULL DEFAULT 0,
    "pars" TEXT NOT NULL DEFAULT '',
    "yards" TEXT NOT NULL DEFAULT '',
    "strokeIndex" TEXT NOT NULL DEFAULT '',
    "tees" TEXT NOT NULL DEFAULT '[]',
    "cardProblem" TEXT NOT NULL DEFAULT '',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseCatalog_name_idx" ON "CourseCatalog"("name");

-- CreateIndex
CREATE INDEX "CourseCatalog_state_idx" ON "CourseCatalog"("state");
