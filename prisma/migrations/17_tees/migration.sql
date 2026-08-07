-- Tees, with the ratings that make a handicap mean something.
--
-- Course Rating and Slope convert a portable Handicap Index into the strokes a
-- player actually receives at one course off one set of tees:
--
--   Course Handicap = Index x (Slope / 113) + (Course Rating - Par)
--
-- Without them the app scored everyone off their raw index, which understates
-- strokes on a hard course and overstates them on an easy one — and treats a
-- member-guest playing mixed tees as though the course were identical for
-- everyone, which is precisely what slope exists to correct.
--
-- Nothing changes for existing tournaments. slopeRating defaults to 0, which
-- the conversion reads as "unrated" and falls back to the raw index — exactly
-- the behaviour every current round already has. Ratings take effect only once
-- a club enters them.
CREATE TABLE "Tee" (
    "id"           TEXT NOT NULL,
    "courseId"     TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    -- any | men | women — whose card this set is rated for.
    "gender"       TEXT NOT NULL DEFAULT 'any',
    "courseRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    -- 113 is the standard slope. 0 means nobody has entered a rating yet.
    "slopeRating"  INTEGER NOT NULL DEFAULT 0,
    "par"          INTEGER NOT NULL DEFAULT 72,
    -- JSON number arrays, one entry per hole. Empty inherits from the course;
    -- championship tees occasionally differ.
    "yards"        TEXT NOT NULL DEFAULT '',
    "pars"         TEXT NOT NULL DEFAULT '',
    "strokeIndex"  TEXT NOT NULL DEFAULT '',
    "position"     INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Tee_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Tee_courseId_idx" ON "Tee"("courseId");

-- Which tees an entry plays from. Null means the round's default.
--
-- ON DELETE SET NULL rather than CASCADE: removing a set of tees from a course
-- must never delete the players who played off them.
ALTER TABLE "Player" ADD COLUMN "teeId" TEXT;

ALTER TABLE "Tee" ADD CONSTRAINT "Tee_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Player" ADD CONSTRAINT "Player_teeId_fkey"
    FOREIGN KEY ("teeId") REFERENCES "Tee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
