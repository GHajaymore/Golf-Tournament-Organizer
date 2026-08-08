-- The rest of a club's theme: the second colour, and light/dark appearance.
--
-- Defaults reproduce exactly what every existing organization renders today
-- (fairway green on the dark ground), so this migration changes no club's
-- appearance until someone chooses otherwise.
ALTER TABLE "Organization" ADD COLUMN "themeSecondaryKey" TEXT NOT NULL DEFAULT 'fairway';
ALTER TABLE "Organization" ADD COLUMN "themeSecondaryHex" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Organization" ADD COLUMN "themeAppearance" TEXT NOT NULL DEFAULT 'dark';
