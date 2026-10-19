-- How players keep a round's matches: "holes" (tap who won each hole) or
-- "cards" (each ball's strokes). Empty is the round's own default, so every
-- existing round keeps exactly what it does today (2026-10-19).
ALTER TABLE "Stage" ADD COLUMN "matchKeptBy" TEXT NOT NULL DEFAULT '';
