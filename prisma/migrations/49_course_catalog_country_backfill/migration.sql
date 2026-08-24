-- Backfill the country for rows catalogued before the column existed.
--
-- The directory only sets `state` on US courses — a Dutch course comes back
-- with state null — so a catalogued row that has a state is a US one. This is
-- arithmetic on data we already hold, not a re-import: no request is made, and
-- the ~570 rows imported state by state would otherwise sit with a blank
-- country until somebody re-fetched all of them.
UPDATE "CourseCatalog"
SET "country" = 'US'
WHERE "country" = '' AND "state" <> '';
