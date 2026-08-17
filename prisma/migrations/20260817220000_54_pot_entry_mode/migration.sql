-- Opt-out pots.
--
-- Every pot was opt-in: a name is in because somebody put it there. That is
-- right for a one-off sweep and wrong for the two commonest things a club
-- runs — a weekly league where the skins are part of turning up, and a
-- closest-to-the-pin that is simply on for everybody. Under opt-in an
-- organizer ticks forty names a week, and a player added on the Thursday is
-- silently out of a pot they believe they are in.
--
-- Default is opt-in, so every pot that exists keeps behaving exactly as it did.
ALTER TABLE "Contest"  ADD COLUMN "entryMode" TEXT NOT NULL DEFAULT 'opt-in';
ALTER TABLE "SideGame" ADD COLUMN "entryMode" TEXT NOT NULL DEFAULT 'opt-in';

-- Out of the pot, as distinct from not having paid. "Took himself out" and
-- "has not paid yet" settle differently — one owes nothing, the other owes the
-- stake — so they are two columns and not one.
ALTER TABLE "ContestEntry"  ADD COLUMN "excluded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SideGameEntry" ADD COLUMN "excluded" BOOLEAN NOT NULL DEFAULT false;
