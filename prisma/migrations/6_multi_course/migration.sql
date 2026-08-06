-- Courses a club plays, and which one a given round or match was played on.
--
-- Two real situations need this, and they differ in *when* the venue is known:
--
--   * A multi-day or multi-week tournament rotates courses, and the organizer
--     booked them months ago. The course belongs to the round, set at setup.
--
--   * A community match-play league has no fixed venue at all: opponents
--     arrange their own match wherever suits them before the deadline. Nobody
--     can know in advance, so the course belongs to the match, recorded when
--     the score is reported.
--
-- Resolution therefore walks match -> round -> event, and the ordinary
-- single-venue tournament sets one course and is never asked again.

CREATE TABLE "Course" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "city"           TEXT NOT NULL DEFAULT '',
    "pars"           TEXT NOT NULL,
    "yards"          TEXT NOT NULL,
    "strokeIndex"    TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Course_organizationId_idx" ON "Course"("organizationId");

CREATE TABLE "EventCourse" (
    "id"       TEXT NOT NULL,
    "eventId"  TEXT NOT NULL,
    "courseId" TEXT NOT NULL,

    CONSTRAINT "EventCourse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventCourse_eventId_courseId_key" ON "EventCourse"("eventId", "courseId");
CREATE INDEX "EventCourse_eventId_idx" ON "EventCourse"("eventId");

-- Null means "inherit" — the round falls back to the event, the match falls
-- back to its round. Only a rotating or venue-less tournament sets them.
ALTER TABLE "Stage"
    ADD COLUMN "courseId" TEXT,
    ADD COLUMN "nine"     TEXT NOT NULL DEFAULT 'full';

ALTER TABLE "Match"
    ADD COLUMN "courseId" TEXT,
    ADD COLUMN "nine"     TEXT NOT NULL DEFAULT 'full';

ALTER TABLE "Course" ADD CONSTRAINT "Course_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventCourse" ADD CONSTRAINT "EventCourse_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventCourse" ADD CONSTRAINT "EventCourse_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: removing a course from the club library must not
-- delete the rounds and matches played on it. They fall back to the event's
-- course, exactly as an unset one does.
ALTER TABLE "Stage" ADD CONSTRAINT "Stage_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Match" ADD CONSTRAINT "Match_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

--------------------------------------------------------------------------------
-- Backfill: lift each event's existing custom course into the club library
--------------------------------------------------------------------------------

-- Events that saved their own hole-by-hole card become a reusable Course, so
-- the data an organizer already entered is not stranded on one tournament.
-- Built-in presets are left alone: they are resolved by name in code and need
-- no row here.
INSERT INTO "Course" ("id", "organizationId", "name", "city", "pars", "yards", "strokeIndex", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    e."organizationId",
    COALESCE(NULLIF(btrim(e."course"), ''), 'Course'),
    e."city",
    e."customPars",
    e."customYards",
    e."customStrokeIndex",
    now(),
    now()
FROM "Event" e
WHERE e."customPars" <> '' AND e."customYards" <> '' AND e."customStrokeIndex" <> '';

-- Attach each newly created course to the event it came from.
INSERT INTO "EventCourse" ("id", "eventId", "courseId")
SELECT gen_random_uuid()::text, e."id", c."id"
FROM "Event" e
JOIN "Course" c
  ON c."organizationId" = e."organizationId"
 AND c."pars" = e."customPars"
 AND c."yards" = e."customYards"
 AND c."strokeIndex" = e."customStrokeIndex"
WHERE e."customPars" <> '' AND e."customYards" <> '' AND e."customStrokeIndex" <> ''
ON CONFLICT ("eventId", "courseId") DO NOTHING;
