-- A point in a cup that is not a match (2026-10-19): the first cup's 16th point,
-- for the lower team net total. Additive: a new table.
CREATE TABLE "CupPoint" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "points" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "groupId" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CupPoint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CupPoint_eventId_idx" ON "CupPoint"("eventId");

ALTER TABLE "CupPoint" ADD CONSTRAINT "CupPoint_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
