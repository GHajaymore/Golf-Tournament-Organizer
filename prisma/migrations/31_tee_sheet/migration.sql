-- The tee sheet, saved as drawn and optionally published to players.
--
-- Until now the sheet existed only in the organizer's browser: regenerated
-- on every visit, gone on refresh, invisible to players, unprintable. Saved
-- as a JSON unit because it is replaced wholesale on regenerate and read as
-- a unit; published as a separate flag because a draft draw is the
-- organizer's until they say otherwise.
ALTER TABLE "Stage" ADD COLUMN "teeSheet" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Stage" ADD COLUMN "teeSheetPublished" BOOLEAN NOT NULL DEFAULT false;
