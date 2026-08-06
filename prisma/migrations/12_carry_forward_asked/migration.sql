-- Whether the organizer has been asked about carry-forward, as opposed to
-- simply never having encountered the question.
--
-- carryForwardEnabled alone cannot tell those apart: false means both "no,
-- rounds start fresh" and "nobody raised it". In a points-based league whether
-- a strong round still counts is the central decision of the format, and it
-- was an unchecked box halfway down a collapsed panel.
--
-- Defaults false, so existing rounds read as never asked — which is accurate.
ALTER TABLE "Stage" ADD COLUMN "carryForwardAsked" BOOLEAN NOT NULL DEFAULT false;
