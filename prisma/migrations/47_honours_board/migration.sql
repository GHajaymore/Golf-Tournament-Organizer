-- CreateTable
CREATE TABLE "HonoursEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "dates" TEXT NOT NULL DEFAULT '',
    "year" INTEGER NOT NULL DEFAULT 0,
    "playerId" TEXT NOT NULL DEFAULT '',
    "championName" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "confirmedBy" TEXT NOT NULL DEFAULT '',
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HonoursEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HonoursEntry_organizationId_idx" ON "HonoursEntry"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "HonoursEntry_eventId_playerId_key" ON "HonoursEntry"("eventId", "playerId");

-- AddForeignKey
ALTER TABLE "HonoursEntry" ADD CONSTRAINT "HonoursEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
