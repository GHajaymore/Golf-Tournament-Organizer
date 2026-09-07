-- When the club last SAVED its colours. Null means it never has.
--
-- Replaces an inference — `themeKey != DEFAULT_THEME` — that was correct only
-- until the default moved, and the default did move.
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "themeSetAt" TIMESTAMP(3);

-- Backfill: mark the clubs that can be SHOWN to have chosen, and only those.
--
-- There is no record of who chose what before this column existed, so the
-- backfill has to infer once — the same inference the code is being taken off,
-- run here where it is a one-time reading of history rather than a rule that
-- has to stay true. What makes it safe here and not there is that this
-- statement knows BOTH historical defaults, which the old code could not: it
-- compared against whatever DEFAULT_THEME happened to be that day.
--
--   sunset/fairway   the defaults every row created before 2026-09-06 carries
--   verdigris/optic  the defaults every row created after it carries
--
-- A club sitting on either pair is treated as having chosen nothing. That is
-- wrong for the club that deliberately picked the stock colours, and it is the
-- direction to be wrong in: the only consequence is one extra optional nudge
-- on a checklist, which disappears the moment they save anything. Marking a
-- club as "already branded" when it is not is the failure that has no floor --
-- it silently withholds the prompt forever, which is exactly the bug being
-- fixed.
--
-- `updatedAt` rather than now(), so a club that branded itself two years ago
-- does not read as having done it during a deploy.
UPDATE "Organization"
SET "themeSetAt" = "updatedAt"
WHERE "themeHex" <> ''
   OR "themeSecondaryHex" <> ''
   OR "themeKey" NOT IN ('sunset', 'verdigris')
   OR "themeSecondaryKey" NOT IN ('fairway', 'optic');
