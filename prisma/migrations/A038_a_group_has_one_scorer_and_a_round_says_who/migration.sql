-- A GROUP HAS ONE SCORER, AND A ROUND SAYS WHO (2026-11-04, sprint 2 part B).
--
-- A038, not A037: `A037_ai_spend_is_recorded` is another branch's, already
-- applied to the development database. Nothing here depends on it, and IF NOT
-- EXISTS below lets a database that ran this under another name keep it.
--
-- Hand-written from `prisma migrate diff --from-schema-datasource ... --to-schema-datamodel ... --script`
-- (read-only), keeping only this change: that diff also carried another branch's
-- drift on the development database (AiSpend, FieldEmailSend, two Event columns),
-- which is not this migration's business and is left out.
--
-- Additive only. Every existing round keeps today's behaviour through the
-- column defaults: "each" player enters their own, and no end-of-round check.
-- A NEW round is given `scoringDefaults(shape)` by the app, not by these defaults.

-- Who enters a round's scores: group | each | organizer. Read through `roundScoring`.
ALTER TABLE "Stage" ADD COLUMN IF NOT EXISTS "scoreKeeping" TEXT NOT NULL DEFAULT 'each';
-- The end-of-round check: on | off. Read through `roundScoring`.
ALTER TABLE "Stage" ADD COLUMN IF NOT EXISTS "endCheck" TEXT NOT NULL DEFAULT 'off';

-- The one phone that keeps a group's card. A claim is an upsert on (stageId, groupKey).
CREATE TABLE "ScoringKeeper" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL DEFAULT 1,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoringKeeper_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScoringKeeper_eventId_idx" ON "ScoringKeeper"("eventId");

CREATE UNIQUE INDEX "ScoringKeeper_stageId_groupKey_key" ON "ScoringKeeper"("stageId", "groupKey");

ALTER TABLE "ScoringKeeper" ADD CONSTRAINT "ScoringKeeper_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScoringKeeper" ADD CONSTRAINT "ScoringKeeper_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScoringKeeper" ADD CONSTRAINT "ScoringKeeper_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
