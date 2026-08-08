-- Team golf: sides, their membership, and their cards.
--
-- The format catalog advertised scramble, four-ball, foursomes and best ball
-- with no model behind any of them, so a round set to one of those had nowhere
-- to record who played with whom. This adds that.
--
-- Two shapes of team golf, and the difference is physical rather than
-- arithmetic:
--
--   * Everyone plays their own ball and the side takes the best score on each
--     hole (four-ball, best ball, shamble). N cards per side.
--
--   * The side plays one ball (foursomes, alternate shot, scramble, Chapman).
--     One card per side, scored against a handicap derived from all partners.
--
-- TeamScorecard.playerId carries that distinction: set for the first shape,
-- empty for the second.

CREATE TABLE "Team" (
    "id"        TEXT NOT NULL,
    "eventId"   TEXT NOT NULL,
    -- NULL means the team plays the whole tournament, which is the
    -- member-guest case where the pairing *is* the entry. A stage id means the
    -- teams were drawn for that round only, which is how a society mixes its
    -- field up week to week. Both are ordinary, so neither is the default.
    "stageId"   TEXT,
    "name"      TEXT NOT NULL,
    "seed"      INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Team_eventId_idx" ON "Team"("eventId");
CREATE INDEX "Team_stageId_idx" ON "Team"("stageId");

CREATE TABLE "TeamMember" (
    "id"       TEXT NOT NULL,
    "teamId"   TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    -- Not cosmetic: foursomes alternate who tees off on odd and even holes,
    -- and the scramble allowance table is applied in ability order.
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);
-- Nobody plays for the same side twice.
CREATE UNIQUE INDEX "TeamMember_teamId_playerId_key" ON "TeamMember"("teamId", "playerId");
CREATE INDEX "TeamMember_teamId_idx" ON "TeamMember"("teamId");
CREATE INDEX "TeamMember_playerId_idx" ON "TeamMember"("playerId");

CREATE TABLE "TeamScorecard" (
    "id"       TEXT NOT NULL,
    "eventId"  TEXT NOT NULL,
    "stageId"  TEXT NOT NULL,
    "teamId"   TEXT NOT NULL,
    -- Empty for a team stroke-play round, which has no opponent; set for team
    -- match play, where each match needs its own card.
    "matchId"  TEXT NOT NULL DEFAULT '',
    -- Empty where the side shares one ball; set to the partner whose ball this
    -- card is where each keeps their own.
    --
    -- Empty string rather than NULL so the unique index below actually
    -- constrains. Postgres treats NULLs as distinct, so a nullable column here
    -- would cheerfully accept two cards for the same single-ball side.
    "playerId" TEXT NOT NULL DEFAULT '',
    "strokes"  TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "TeamScorecard_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TeamScorecard_stageId_matchId_teamId_playerId_key"
    ON "TeamScorecard"("stageId", "matchId", "teamId", "playerId");
CREATE INDEX "TeamScorecard_eventId_idx" ON "TeamScorecard"("eventId");
CREATE INDEX "TeamScorecard_teamId_idx" ON "TeamScorecard"("teamId");

-- The two sides of a match, when the sides are teams.
--
-- Separate columns rather than repurposing playerAId/playerBId: a column whose
-- meaning depends on the round's format is exactly the kind of thing that
-- silently mis-joins a year later. Empty string matches how the rest of the
-- schema models "not set".
ALTER TABLE "Match" ADD COLUMN "teamAId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Match" ADD COLUMN "teamBId" TEXT NOT NULL DEFAULT '';

-- Deleting a tournament or a round takes its teams with it; deleting a player
-- removes them from the side rather than orphaning the row.
ALTER TABLE "Team" ADD CONSTRAINT "Team_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Team" ADD CONSTRAINT "Team_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_playerId_fkey"
    FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamScorecard" ADD CONSTRAINT "TeamScorecard_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamScorecard" ADD CONSTRAINT "TeamScorecard_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
