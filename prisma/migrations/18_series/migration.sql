-- A season-long competition across many tournaments — an order of merit.
--
-- Standings aggregate on Member, never on Player. A Player row belongs to one
-- event, so the same golfer entering twelve league rounds is twelve rows;
-- totalling those would give one person twelve lines each holding a twelfth of
-- their points. The club roster exists so there is one record of a person to
-- hang a season on, and this is what it was for.
--
-- Points come from finishing position rather than score, because a season can
-- mix stroke play, Stableford and match play — numbers that cannot be added
-- together. Position is the only currency every format shares, and it is what
-- every league table an organizer has ever seen already uses.
CREATE TABLE "Series" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "description"    TEXT NOT NULL DEFAULT '',
    -- JSON number array: points for 1st, 2nd, 3rd... Empty uses the default.
    "pointsTable"    TEXT NOT NULL DEFAULT '',
    -- Count only this many best results. 0 counts everything. Most seasons let
    -- a player drop their worst rounds so missing a week isn't fatal.
    "bestOf"         INTEGER NOT NULL DEFAULT 0,
    -- Events a member must play before being ranked, so somebody who turned up
    -- once and won doesn't top a twelve-round order of merit.
    "minEvents"      INTEGER NOT NULL DEFAULT 0,
    "status"         TEXT NOT NULL DEFAULT 'active',
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Series_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Series_organizationId_idx" ON "Series"("organizationId");

-- Null is the ordinary case: most tournaments stand alone.
--
-- ON DELETE SET NULL, never CASCADE: deleting a season must not delete the
-- tournaments that counted towards it. A club winding up its winter league
-- still wants the rounds it played.
ALTER TABLE "Event" ADD COLUMN "seriesId" TEXT;

ALTER TABLE "Series" ADD CONSTRAINT "Series_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_seriesId_fkey"
    FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE SET NULL ON UPDATE CASCADE;
