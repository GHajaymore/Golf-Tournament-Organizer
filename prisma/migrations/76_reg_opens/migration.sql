-- The first day a tournament takes entries.
--
-- There was only a closing date (`regDeadline`), so "entries open on the 1st"
-- could be announced and not enforced: entries opened whenever the organizer
-- flipped self sign-up on. Members now register themselves from the list of
-- their club's tournaments, which shows both dates, so both have to be real.
--
-- Empty string means "no opening date" — exactly how every existing tournament
-- behaves today, so this changes nothing until an organizer sets one.
ALTER TABLE "Event" ADD COLUMN "regOpens" TEXT NOT NULL DEFAULT '';
