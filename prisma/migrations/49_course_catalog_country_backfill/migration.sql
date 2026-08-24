-- Backfill the country for rows catalogued before the column existed.
--
-- The directory only sets `state` on US courses — a Dutch course comes back
-- with state null — so a catalogued row that has a state is a US one. This is
-- arithmetic on data we already hold: no request is made, and the rows
-- imported state by state would otherwise sit with a blank country until
-- somebody re-fetched all of them.
--
-- Naturally idempotent: the WHERE clause only matches rows that still have no
-- country, so re-running it after a folder rename changes nothing. See the
-- note in 48_course_catalog_country for why re-running is expected.
UPDATE "CourseCatalog"
SET "country" = 'US'
WHERE "country" = '' AND "state" <> '';
