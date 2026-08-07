-- An explicit reprieve from the retention window.
--
-- For demos, a disputed result still being argued over, or an event a club has
-- asked to have held. Retention takes the later of the plan window and this
-- value, so setting it can only extend — it can never shorten a window an
-- organizer was already promised.
ALTER TABLE "Event" ADD COLUMN "retainUntil" TIMESTAMP(3);
