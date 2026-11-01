-- Renumbered from A020 (2026-10-31, backlog A8): it replays after main's A030 and the Print kit's A031.
-- IF NOT EXISTS: a database that ran it under the old name keeps what it made.
-- The report's settings (2026-10-24): who may open its link, and who sees side-game amounts.
-- Defaults are the rule before them: anyone with the board's link; amounts for the field only.
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "reportVisibility" TEXT NOT NULL DEFAULT 'board',
ADD COLUMN IF NOT EXISTS "reportAmounts" TEXT NOT NULL DEFAULT 'players';

-- "Don't show my name on public pages", on the player's entry.
ALTER TABLE "Player" ADD COLUMN IF NOT EXISTS "publicNameWithheld" BOOLEAN NOT NULL DEFAULT false;
