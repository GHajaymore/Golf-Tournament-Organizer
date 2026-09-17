-- WHO WON THE PLAY-OFF HOLE, when a play-off meeting finishes level.
--
-- A tied meeting used to send the higher seed through. That is a rule some
-- leagues publish, and it is not this one's: a level play-off meeting is
-- settled on the course, sudden death, and the app cannot know the result
-- because nobody scores a play-off hole into it. So the organizer records it,
-- and until they do the bracket says the tie is unresolved rather than
-- inventing a winner from the seeding.
--
-- One row per meeting: the two clubs are stored sorted, so a decision cannot
-- be entered twice under two orderings.
CREATE TABLE "LeaguePlayoffHole" (
  "id"          TEXT NOT NULL,
  "eventId"     TEXT NOT NULL,
  "stageId"     TEXT NOT NULL,
  "clubLowId"   TEXT NOT NULL,
  "clubHighId"  TEXT NOT NULL,
  "winnerId"    TEXT NOT NULL,
  "decidedBy"   TEXT NOT NULL DEFAULT '',
  "decidedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaguePlayoffHole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeaguePlayoffHole_stageId_clubLowId_clubHighId_key"
  ON "LeaguePlayoffHole"("stageId", "clubLowId", "clubHighId");
CREATE INDEX "LeaguePlayoffHole_eventId_idx" ON "LeaguePlayoffHole"("eventId");

ALTER TABLE "LeaguePlayoffHole"
  ADD CONSTRAINT "LeaguePlayoffHole_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaguePlayoffHole"
  ADD CONSTRAINT "LeaguePlayoffHole_stageId_fkey"
  FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
