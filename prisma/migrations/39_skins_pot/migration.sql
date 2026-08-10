-- A skins pot on one round of a league.
--
-- Per round rather than per event: a league runs one a week and each week
-- stands alone, with its own entrants, pot and result.
--
-- Entrants are stored explicitly rather than derived from who is playing.
-- Attendance answers "are you here this week"; this answers "did you put money
-- in", which is a cash transaction at the first tee that only the person
-- collecting it knows about. Entering someone who never paid would produce a
-- settlement sheet that is wrong in the way that loses a club's trust.
--
-- Amounts are whole cents as integers, so no total is ever a rounded float.
-- TourneyHQ calculates and records this money; it never moves it.
CREATE TABLE "SkinsPot" (
  "id"            TEXT NOT NULL,
  "eventId"       TEXT NOT NULL,
  "stageId"       TEXT NOT NULL,
  "buyInCents"    INTEGER NOT NULL DEFAULT 0,
  "net"           BOOLEAN NOT NULL DEFAULT true,
  "scope"         TEXT NOT NULL DEFAULT 'full',
  "carryInCents"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkinsPot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SkinsPot_stageId_key" ON "SkinsPot"("stageId");
CREATE INDEX "SkinsPot_eventId_idx" ON "SkinsPot"("eventId");

ALTER TABLE "SkinsPot" ADD CONSTRAINT "SkinsPot_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SkinsPot" ADD CONSTRAINT "SkinsPot_stageId_fkey"
  FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One player's stake in one week's pot.
CREATE TABLE "SkinsEntry" (
  "id"       TEXT NOT NULL,
  "potId"    TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  CONSTRAINT "SkinsEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SkinsEntry_potId_playerId_key" ON "SkinsEntry"("potId", "playerId");
CREATE INDEX "SkinsEntry_playerId_idx" ON "SkinsEntry"("playerId");

ALTER TABLE "SkinsEntry" ADD CONSTRAINT "SkinsEntry_potId_fkey"
  FOREIGN KEY ("potId") REFERENCES "SkinsPot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SkinsEntry" ADD CONSTRAINT "SkinsEntry_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
