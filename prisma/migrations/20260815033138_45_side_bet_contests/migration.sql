-- CreateTable
CREATE TABLE "Contest" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'other',
    "name" TEXT NOT NULL,
    "hole" INTEGER NOT NULL DEFAULT 0,
    "buyInCents" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestEntry" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "won" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ContestEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contest_eventId_idx" ON "Contest"("eventId");

-- CreateIndex
CREATE INDEX "Contest_stageId_idx" ON "Contest"("stageId");

-- CreateIndex
CREATE INDEX "ContestEntry_contestId_idx" ON "ContestEntry"("contestId");

-- CreateIndex
CREATE UNIQUE INDEX "ContestEntry_contestId_playerId_key" ON "ContestEntry"("contestId", "playerId");

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestEntry" ADD CONSTRAINT "ContestEntry_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
