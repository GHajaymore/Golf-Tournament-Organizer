-- The club's accent colour, as a preset key rather than a raw hex value.
--
-- Storing a colour would let a club choose one the app cannot stay readable
-- against — the pale yellow off the crest, and the accent text disappears.
-- The presets in src/lib/themes.ts are generated on a fixed lightness ramp and
-- asserted against the real page and card backgrounds, so whichever a club
-- picks, the contrast holds.
--
-- Defaults to the existing orange, so nothing re-skins itself.
ALTER TABLE "Organization" ADD COLUMN "themeKey" TEXT NOT NULL DEFAULT 'sunset';
