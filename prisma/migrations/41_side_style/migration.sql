-- Whether people play as individuals or as a side, asked once at setup.
--
-- A default for the round builder and a navigation hint, never a constraint:
-- team-ness lives on each round's format because it genuinely varies within
-- one tournament. Existing events take "individual", which is exactly how
-- they behave today.
ALTER TABLE "Event" ADD COLUMN "sideStyle" TEXT NOT NULL DEFAULT 'individual';
