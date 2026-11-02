-- ONE NAME IN PLAY PER CLUB (Ajay, 2026-11-01: "year may not solve. what if they run same
-- tournament twice a year?"). The rule is `domain/tournament-name.ts`; this is its backstop
-- for a race between two presses, and nothing more.
--
-- No two of a club's tournaments still IN PLAY (draft, registration, ready, live) may share a
-- name, compared without case and with runs of spaces collapsed and the ends trimmed — the same
-- normalising as `nameKey`. Completed tournaments and casual rounds (shape 'match') are outside
-- it: they may share a name with anything.
--
-- PARTIAL AND ON AN EXPRESSION, which Prisma's schema language cannot say, so schema.prisma
-- carries a comment on `Event` instead of an @@unique. A migration Prisma generates later that
-- DROPs "Event_name_in_play_key" must have that line deleted (docs/claude/migrations.md).
--
-- GUARDED: the index is made ONLY where no two in-play tournaments of one club already share a
-- name. Production holds real events; a duplicate there is left exactly as it is, never renamed
-- and never blocked, and the app's own check (which every door calls) still refuses a NEW clash.
-- Run again later, by hand, once the duplicates have been resolved by their clubs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "Event"
    WHERE "status" IN ('draft', 'registration', 'ready', 'live') AND "shape" <> 'match'
    GROUP BY "organizationId", lower(btrim(regexp_replace("name", '\s+', ' ', 'g')))
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "Event_name_in_play_key"
      ON "Event" ("organizationId", lower(btrim(regexp_replace("name", '\s+', ' ', 'g'))))
      WHERE "status" IN ('draft', 'registration', 'ready', 'live') AND "shape" <> 'match';
  ELSE
    RAISE NOTICE 'Event_name_in_play_key not created: a club already holds two in-play tournaments of one name';
  END IF;
END $$;
