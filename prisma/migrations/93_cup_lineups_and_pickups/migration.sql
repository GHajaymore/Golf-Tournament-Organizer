-- A team cup session's lineup is hidden until the organizer announces it.
-- Every session that already has matches was being shown, so it stays shown:
-- nothing a club can already see disappears with this migration.
ALTER TABLE "Stage" ADD COLUMN "lineupPublished" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Stage" SET "lineupPublished" = true
WHERE "type" = 'Team Session'
  AND EXISTS (SELECT 1 FROM "Match" m WHERE m."stageId" = "Stage"."id");

-- A ball picked up on a hole, in match play, beside the strokes rather than
-- inside them. Empty on every existing card: nobody picked up anywhere.
ALTER TABLE "TeamScorecard" ADD COLUMN "pickedUp" TEXT NOT NULL DEFAULT '[]';
