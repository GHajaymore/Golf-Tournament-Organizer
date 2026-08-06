-- What shape of tournament this is, asked once at the start.
--
-- Until now the app never asked, so every tournament was offered every
-- control: a one-day charity scramble showed a carry-forward percentage and a
-- cut line into a round that would never exist, and a straight knockout showed
-- round-robin scoring it would never use.
--
-- Defaults to 'series' because that shows every control, which is exactly what
-- existing tournaments do today — nothing changes underneath anyone.
ALTER TABLE "Event" ADD COLUMN "shape" TEXT NOT NULL DEFAULT 'series';
