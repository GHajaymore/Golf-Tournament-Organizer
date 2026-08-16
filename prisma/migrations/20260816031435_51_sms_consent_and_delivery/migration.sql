-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "smsOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smsOptInAt" TIMESTAMP(3),
ADD COLUMN     "smsOptOutAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SmsDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT,
    "threadId" TEXT,
    "scopeKey" TEXT NOT NULL DEFAULT '',
    "toPhone" TEXT NOT NULL,
    "toName" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "segments" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT NOT NULL DEFAULT '',
    "providerId" TEXT NOT NULL DEFAULT '',
    "sentByEmail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsDelivery_organizationId_createdAt_idx" ON "SmsDelivery"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "SmsDelivery_eventId_idx" ON "SmsDelivery"("eventId");

-- CreateIndex
CREATE INDEX "SmsDelivery_threadId_idx" ON "SmsDelivery"("threadId");
