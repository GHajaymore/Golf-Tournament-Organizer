-- AN ENTRY SAYS MEMBER OR GUEST (2026-11-07, the no-email player identity, PR 1).
--
-- Ajay, 7 Nov: organizers need an email; members may enter without one;
-- guests ("Guest (not a club member)") need none. With a member allowed no
-- email, a blank email no longer says guest, so the standing is stored.
--
-- Hand-written, one statement. Additive, NO BACKFILL: every entry that exists
-- today keeps '' and reads as a member (`entryStanding`), so no existing
-- event's rows are written. IF NOT EXISTS lets a database that ran this under
-- another name keep it.

-- member | guest | '' (= member, made before this). Read through `entryStanding`.
ALTER TABLE "Player" ADD COLUMN IF NOT EXISTS "standing" TEXT NOT NULL DEFAULT '';
