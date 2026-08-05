-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "password" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dates" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'match',
    "course" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "customPars" TEXT NOT NULL DEFAULT '',
    "customYards" TEXT NOT NULL DEFAULT '',
    "customStrokeIndex" TEXT NOT NULL DEFAULT '',
    "regDeadline" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 32,
    "playerCountMode" TEXT NOT NULL DEFAULT 'registration',
    "manualPlayerCount" INTEGER NOT NULL DEFAULT 32,
    "formationRule" TEXT NOT NULL DEFAULT 'balanced',
    "flightMode" TEXT NOT NULL DEFAULT 'auto',
    "flightValue" INTEGER NOT NULL DEFAULT 0,
    "qualifyPerGroup" INTEGER NOT NULL DEFAULT 2,
    "qualifyMode" TEXT NOT NULL DEFAULT 'perFlight',
    "qualifyOverall" INTEGER NOT NULL DEFAULT 16,
    "winPts" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "tiePts" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "lossPts" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "holeRatioPts" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "bonusPts" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tiebreakers" TEXT NOT NULL DEFAULT '["head-to-head","holes-won-ratio","fewest-holes-lost","lower-handicap"]',
    "inviteMessage" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "configUnlocked" BOOLEAN NOT NULL DEFAULT false,
    "launchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'player',

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "handicap" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "seed" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "ghin" TEXT NOT NULL DEFAULT '',
    "homeClub" TEXT NOT NULL DEFAULT '',
    "gender" TEXT NOT NULL DEFAULT '',
    "preferredTee" TEXT NOT NULL DEFAULT '',
    "handicapSource" TEXT NOT NULL DEFAULT 'manual',
    "handicapType" TEXT NOT NULL DEFAULT '18',
    "groupId" TEXT,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stage" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "format" TEXT NOT NULL DEFAULT 'Match Play',
    "holes" INTEGER NOT NULL DEFAULT 18,
    "deadline" TEXT NOT NULL DEFAULT '',
    "scoringBasis" TEXT NOT NULL DEFAULT 'gross',
    "carryForwardEnabled" BOOLEAN NOT NULL DEFAULT false,
    "carryForwardPct" INTEGER NOT NULL DEFAULT 0,
    "cutEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cutMode" TEXT NOT NULL DEFAULT 'count',
    "cutCount" INTEGER NOT NULL DEFAULT 16,
    "cutPercent" INTEGER NOT NULL DEFAULT 50,

    CONSTRAINT "Stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "playerAId" TEXT NOT NULL,
    "playerBId" TEXT NOT NULL,
    "holes" TEXT NOT NULL DEFAULT '[]',
    "scoreStatus" TEXT NOT NULL DEFAULT 'pending',
    "scoredAt" TIMESTAMP(3),
    "confirmedById" TEXT,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "matchId" TEXT,
    "actor" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BracketWinner" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "winnerId" TEXT NOT NULL,
    "result" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "BracketWinner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commentary" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'organizer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Commentary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prize" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "winnerId" TEXT,

    CONSTRAINT "Prize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scorecard" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "strokes" TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "Scorecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchScorecard" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "strokes" TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "MatchScorecard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "Account_eventId_idx" ON "Account"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_eventId_email_key" ON "Account"("eventId", "email");

-- CreateIndex
CREATE INDEX "Player_eventId_idx" ON "Player"("eventId");

-- CreateIndex
CREATE INDEX "Player_groupId_idx" ON "Player"("groupId");

-- CreateIndex
CREATE INDEX "Group_eventId_idx" ON "Group"("eventId");

-- CreateIndex
CREATE INDEX "Stage_eventId_idx" ON "Stage"("eventId");

-- CreateIndex
CREATE INDEX "Match_eventId_idx" ON "Match"("eventId");

-- CreateIndex
CREATE INDEX "Match_stageId_idx" ON "Match"("stageId");

-- CreateIndex
CREATE INDEX "Match_groupId_idx" ON "Match"("groupId");

-- CreateIndex
CREATE INDEX "AuditLog_eventId_idx" ON "AuditLog"("eventId");

-- CreateIndex
CREATE INDEX "BracketWinner_eventId_idx" ON "BracketWinner"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "BracketWinner_eventId_key_key" ON "BracketWinner"("eventId", "key");

-- CreateIndex
CREATE INDEX "Commentary_eventId_idx" ON "Commentary"("eventId");

-- CreateIndex
CREATE INDEX "Prize_eventId_idx" ON "Prize"("eventId");

-- CreateIndex
CREATE INDEX "Announcement_eventId_idx" ON "Announcement"("eventId");

-- CreateIndex
CREATE INDEX "Scorecard_eventId_idx" ON "Scorecard"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Scorecard_stageId_playerId_key" ON "Scorecard"("stageId", "playerId");

-- CreateIndex
CREATE INDEX "MatchScorecard_eventId_idx" ON "MatchScorecard"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchScorecard_matchId_slot_key" ON "MatchScorecard"("matchId", "slot");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stage" ADD CONSTRAINT "Stage_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BracketWinner" ADD CONSTRAINT "BracketWinner_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commentary" ADD CONSTRAINT "Commentary_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prize" ADD CONSTRAINT "Prize_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchScorecard" ADD CONSTRAINT "MatchScorecard_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchScorecard" ADD CONSTRAINT "MatchScorecard_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

