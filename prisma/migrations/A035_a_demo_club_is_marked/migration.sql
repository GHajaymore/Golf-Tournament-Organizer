-- Renumbered from A028 (2026-10-31, backlog A8): it replays after main's A030 and the Print kit's A031.
-- IF NOT EXISTS: a database that ran it under the old name keeps what it made.
-- THE DEMO CLUB IS MARKED (2026-10-24; docs/claude/demo-club.md).
--
-- False for every club that exists, so nothing already stored changes. The
-- owner's "Demo club: create / refresh" on /owner is the only writer of a true,
-- on the one invented club it builds.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false;
