-- Make the club roster the primary record of who plays here.
--
-- Players existed only inside individual tournaments, so a member who played
-- twelve events was twelve unrelated rows: no history, nowhere to correct a
-- phone number once, and no answer to "what has this member played?".
--
-- This introduces Member (the roster, owned by the organization) and links
-- each Player entry to one. Player keeps its own handicap: that is the value
-- used for *that* tournament, so correcting an index today can never rewrite
-- last season's results.

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "ghin" TEXT NOT NULL DEFAULT '',
    "homeClub" TEXT NOT NULL DEFAULT '',
    "gender" TEXT NOT NULL DEFAULT '',
    "preferredTee" TEXT NOT NULL DEFAULT '',
    "memberNumber" TEXT NOT NULL DEFAULT '',
    "handicap" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "handicapType" TEXT NOT NULL DEFAULT '18',
    "handicapSource" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Member_organizationId_idx" ON "Member"("organizationId");
CREATE INDEX "Member_organizationId_status_idx" ON "Member"("organizationId", "status");

-- One roster entry per email per club. Partial, because most rosters have
-- some members with no email on file and blank strings must not collide.
CREATE UNIQUE INDEX "Member_org_email_key"
    ON "Member"("organizationId", lower("email"))
    WHERE "email" <> '';

ALTER TABLE "Player" ADD COLUMN "memberId" TEXT;

--------------------------------------------------------------------------------
-- Backfill: build each organization's roster from the players in its events
--------------------------------------------------------------------------------

-- Identity key: email where present (people change clubs and names, but an
-- email is stable), otherwise the lowercased name. Matching on name alone is
-- imperfect — two different "J. Smith" would merge — but leaving every entry
-- unlinked would be worse, and organizers can split them on the roster screen.
CREATE TEMP TABLE "_player_identity" AS
SELECT
    p."id"            AS player_id,
    e."organizationId" AS org_id,
    CASE
        WHEN btrim(p."email") <> '' THEN 'e:' || lower(btrim(p."email"))
        ELSE 'n:' || lower(btrim(p."name"))
    END AS identity_key
FROM "Player" p
JOIN "Event" e ON e."id" = p."eventId";

-- One Member per distinct identity per organization, taking the most recent
-- non-empty value for each field so the roster starts as complete as possible.
CREATE TEMP TABLE "_member_seed" AS
SELECT
    gen_random_uuid()::text AS member_id,
    i.org_id,
    i.identity_key,
    (array_agg(p."name"          ORDER BY p."id" DESC))[1]                                AS name,
    COALESCE((array_agg(NULLIF(btrim(p."email"), '') ORDER BY p."id" DESC) FILTER (WHERE NULLIF(btrim(p."email"), '') IS NOT NULL))[1], '') AS email,
    COALESCE((array_agg(NULLIF(btrim(p."phone"), '') ORDER BY p."id" DESC) FILTER (WHERE NULLIF(btrim(p."phone"), '') IS NOT NULL))[1], '') AS phone,
    COALESCE((array_agg(NULLIF(btrim(p."ghin"), '')  ORDER BY p."id" DESC) FILTER (WHERE NULLIF(btrim(p."ghin"), '')  IS NOT NULL))[1], '') AS ghin,
    COALESCE((array_agg(NULLIF(btrim(p."homeClub"), '') ORDER BY p."id" DESC) FILTER (WHERE NULLIF(btrim(p."homeClub"), '') IS NOT NULL))[1], '') AS home_club,
    COALESCE((array_agg(NULLIF(btrim(p."gender"), '') ORDER BY p."id" DESC) FILTER (WHERE NULLIF(btrim(p."gender"), '') IS NOT NULL))[1], '') AS gender,
    COALESCE((array_agg(NULLIF(btrim(p."preferredTee"), '') ORDER BY p."id" DESC) FILTER (WHERE NULLIF(btrim(p."preferredTee"), '') IS NOT NULL))[1], '') AS preferred_tee,
    (array_agg(p."handicap"       ORDER BY p."id" DESC))[1]                               AS handicap,
    (array_agg(p."handicapType"   ORDER BY p."id" DESC))[1]                               AS handicap_type,
    (array_agg(p."handicapSource" ORDER BY p."id" DESC))[1]                               AS handicap_source
FROM "_player_identity" i
JOIN "Player" p ON p."id" = i.player_id
GROUP BY i.org_id, i.identity_key;

INSERT INTO "Member" (
    "id", "organizationId", "name", "email", "phone", "ghin", "homeClub",
    "gender", "preferredTee", "handicap", "handicapType", "handicapSource",
    "status", "createdAt", "updatedAt"
)
SELECT
    member_id, org_id, name, email, phone, ghin, home_club,
    gender, preferred_tee, handicap, handicap_type, handicap_source,
    'active', now(), now()
FROM "_member_seed";

-- Link every existing entry to its roster record.
UPDATE "Player" p
SET "memberId" = s.member_id
FROM "_player_identity" i
JOIN "_member_seed" s
  ON s.org_id = i.org_id AND s.identity_key = i.identity_key
WHERE i.player_id = p."id";

DROP TABLE "_member_seed";
DROP TABLE "_player_identity";

--------------------------------------------------------------------------------
-- Constraints
--------------------------------------------------------------------------------

CREATE INDEX "Player_memberId_idx" ON "Player"("memberId");

-- SET NULL, not CASCADE: removing someone from the roster must not delete the
-- tournaments they played in.
ALTER TABLE "Member" ADD CONSTRAINT "Member_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Player" ADD CONSTRAINT "Player_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
