-- Outbound email that did not reach its recipient.
--
-- Every send in this app is fire-and-forget, so until now a refused email had
-- nowhere to appear. Recorded here and summarised on the Access screen.
CREATE TABLE "EmailFailure" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "toEmail" TEXT NOT NULL DEFAULT '',
    "toName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailFailure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailFailure_organizationId_createdAt_idx" ON "EmailFailure"("organizationId", "createdAt");
