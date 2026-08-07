-- A club's own accent colour, used when themeKey is 'custom'.
--
-- Stored as entered, but only its hue and saturation are honoured: the ramp
-- built from it replaces the lightness with a curve solved per hue against the
-- app's real backgrounds. That is what makes an open colour field safe — a
-- club can enter the pale yellow off its crest and still get readable text.
ALTER TABLE "Organization" ADD COLUMN "themeHex" TEXT NOT NULL DEFAULT '';
