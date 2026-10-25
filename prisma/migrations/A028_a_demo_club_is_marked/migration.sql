-- THE DEMO CLUB IS MARKED (2026-10-24; docs/claude/demo-club.md).
--
-- False for every club that exists, so nothing already stored changes. The
-- owner's "Demo club: create / refresh" on /owner is the only writer of a true,
-- on the one invented club it builds.
ALTER TABLE "Organization" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
