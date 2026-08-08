-- Weekly-league attendance: who is in for which round.
--
-- "everyone" reproduces existing behaviour — every confirmed player is in
-- every round — so no tournament changes until an organizer chooses a mode.
-- Only explicit choices become rows; absence means the league's default,
-- which is what lets "by default you're in" be literally true for a
-- forty-player roster without forty rows.
ALTER TABLE "Event" ADD COLUMN "attendanceMode" TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE "Stage" ADD COLUMN "optDeadline" TEXT NOT NULL DEFAULT '';

CREATE TABLE "RoundAttendance" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "RoundAttendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoundAttendance_stageId_playerId_key" ON "RoundAttendance"("stageId", "playerId");
CREATE INDEX "RoundAttendance_eventId_idx" ON "RoundAttendance"("eventId");

ALTER TABLE "RoundAttendance" ADD CONSTRAINT "RoundAttendance_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoundAttendance" ADD CONSTRAINT "RoundAttendance_stageId_fkey"
  FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoundAttendance" ADD CONSTRAINT "RoundAttendance_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
