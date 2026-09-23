-- Launching a tournament gates player access to it — for tournaments created
-- from here on, and for no tournament that already exists.
--
-- THE BACKFILL IS THE POINT OF THIS MIGRATION, not the column. Tournaments are
-- being PLAYED IN DRAFT today (the seeded Demo Cup is one), and a gate applied
-- to them would lock live players out of rounds they are halfway through. The
-- column default gates everything created afterwards; the UPDATE undoes it for
-- everything already here.
--
-- Written by hand on top of what Prisma generated, which was the ALTER alone
-- and would have gated every stored tournament. Ajay's call of 2026-09-23 was
-- explicitly "gate NEW tournaments only", chosen over a one-time backfill that
-- treats anything holding a result as launched.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "accessGated" BOOLEAN NOT NULL DEFAULT true;

-- Every tournament that existed when the gate was added keeps the behaviour it
-- was created under. Unconditional on purpose: "already here" is the whole
-- condition, and a WHERE on status or results would gate some of them.
UPDATE "Event" SET "accessGated" = false;
