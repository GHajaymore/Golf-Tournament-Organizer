-- CreateTable
CREATE TABLE "RoundHandicap" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "override" INTEGER,
    "frozen" INTEGER,
    "frozenAt" TIMESTAMP(3),

    CONSTRAINT "RoundHandicap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoundHandicap_eventId_idx" ON "RoundHandicap"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "RoundHandicap_stageId_playerId_key" ON "RoundHandicap"("stageId", "playerId");

-- AddForeignKey
ALTER TABLE "RoundHandicap" ADD CONSTRAINT "RoundHandicap_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
