-- Sign-off for a hand-built flight draw.
--
-- Defaults to false, which for every existing tournament means "not yet
-- confirmed" — the editable state they are already in. No draw changes.
ALTER TABLE "Event" ADD COLUMN "flightsConfirmed" BOOLEAN NOT NULL DEFAULT false;
