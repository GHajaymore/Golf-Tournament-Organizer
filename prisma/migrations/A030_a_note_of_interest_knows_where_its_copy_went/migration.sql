-- Where the copy of a note of interest to inquiries@ got to (2026-10-30): the
-- provider's message id and its delivery status. Additive.
ALTER TABLE "InterestRequest" ADD COLUMN "notifyId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "InterestRequest" ADD COLUMN "notifyStatus" TEXT NOT NULL DEFAULT '';
ALTER TABLE "InterestRequest" ADD COLUMN "notifyDetail" TEXT NOT NULL DEFAULT '';
ALTER TABLE "InterestRequest" ADD COLUMN "notifyAt" TIMESTAMP(3);
CREATE INDEX "InterestRequest_notifyId_idx" ON "InterestRequest"("notifyId");
