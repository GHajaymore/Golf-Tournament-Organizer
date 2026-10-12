-- A sign-in has an end (2026-10-11).
--
-- The session cookie carried the signed user id alone, so a password reset
-- ended nobody's session. It now carries when it was issued, and a reset moves
-- this date to now: no sign-in issued before it is good any more.
--
-- Nullable with no default: somebody who has never reset has had nothing ended.
-- Adds a column and writes no row, so it is safe on a populated table and on
-- an empty one.
ALTER TABLE "User" ADD COLUMN "sessionsValidFrom" TIMESTAMP(3);
