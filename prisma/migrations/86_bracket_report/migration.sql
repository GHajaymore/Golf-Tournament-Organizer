-- A knockout result a player has reported, waiting for staff approval.
-- A separate table so no reader of "BracketWinner" can mistake it for a result.

-- CreateTable
CREATE TABLE "BracketReport" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "winnerId" TEXT NOT NULL,
    "result" TEXT NOT NULL DEFAULT '',
    "reportedById" TEXT NOT NULL,
    "reportedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BracketReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BracketReport_eventId_idx" ON "BracketReport"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "BracketReport_eventId_key_key" ON "BracketReport"("eventId", "key");

-- AddForeignKey
ALTER TABLE "BracketReport" ADD CONSTRAINT "BracketReport_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
