-- A recorded payment remembers what it was paying.
--
-- The standing balance is computed live from the expenses, the skins and the
-- side games. So a settlement that exactly cleared a debt stops looking like
-- one the moment any input changes -- an expense edited, a skins result
-- corrected, a money rule fixed -- and there is nothing on the row to say what
-- the figure was when the money actually changed hands.
--
-- Both columns are NULL/empty for rows written before this, and stay that way.
-- A backfill would have to invent the position at a past moment from today's
-- rules, which is precisely the number that cannot be trusted -- and a zero
-- would read as "nothing was owed", which is a statement, not an absence.
ALTER TABLE "Settlement" ADD COLUMN "owedCents" INTEGER;
ALTER TABLE "Settlement" ADD COLUMN "rulesVersion" TEXT NOT NULL DEFAULT '';
