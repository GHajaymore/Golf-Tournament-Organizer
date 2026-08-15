-- CreateTable
CREATE TABLE "SideGame" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "buyInCents" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SideGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SideGameEntry" (
    "id" TEXT NOT NULL,
    "sideGameId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,

    CONSTRAINT "SideGameEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SideGame_eventId_idx" ON "SideGame"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "SideGame_stageId_kind_key" ON "SideGame"("stageId", "kind");

-- CreateIndex
CREATE INDEX "SideGameEntry_sideGameId_idx" ON "SideGameEntry"("sideGameId");

-- CreateIndex
CREATE UNIQUE INDEX "SideGameEntry_sideGameId_playerId_key" ON "SideGameEntry"("sideGameId", "playerId");

-- AddForeignKey
ALTER TABLE "SideGame" ADD CONSTRAINT "SideGame_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SideGameEntry" ADD CONSTRAINT "SideGameEntry_sideGameId_fkey" FOREIGN KEY ("sideGameId") REFERENCES "SideGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;
