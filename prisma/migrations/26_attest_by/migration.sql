-- How many playing partners must confirm a card, when players approve
-- between themselves rather than staff.
--
-- "marker" reproduces what a club medal has always required — one other
-- player signs your card — so every existing tournament keeps behaving the
-- way its members expect.
ALTER TABLE "Event" ADD COLUMN "attestBy" TEXT NOT NULL DEFAULT 'marker';
