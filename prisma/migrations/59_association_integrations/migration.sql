-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "handicapAuthorityId" TEXT NOT NULL DEFAULT 'ghin',
ADD COLUMN     "handicapPolicy" TEXT NOT NULL DEFAULT 'club',
ADD COLUMN     "scoreReporterId" TEXT NOT NULL DEFAULT 'ghin',
ADD COLUMN     "scoreReportingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "secret" TEXT NOT NULL DEFAULT '',
    "settings" TEXT NOT NULL DEFAULT '{}',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandicapPost" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "postKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "providerId" TEXT NOT NULL DEFAULT 'ghin',
    "reference" TEXT NOT NULL DEFAULT '',
    "refusal" TEXT NOT NULL DEFAULT '',
    "detail" TEXT NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandicapPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Integration_organizationId_idx" ON "Integration"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_organizationId_providerId_capability_key" ON "Integration"("organizationId", "providerId", "capability");

-- CreateIndex
CREATE INDEX "HandicapPost_eventId_idx" ON "HandicapPost"("eventId");

-- CreateIndex
CREATE INDEX "HandicapPost_status_idx" ON "HandicapPost"("status");

-- CreateIndex
CREATE UNIQUE INDEX "HandicapPost_postKey_key" ON "HandicapPost"("postKey");

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandicapPost" ADD CONSTRAINT "HandicapPost_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
