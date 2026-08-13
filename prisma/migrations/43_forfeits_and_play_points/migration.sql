-- Two additions, both purely additive with defaults, so every existing row
-- keeps behaving exactly as it does today.
--
-- Event.playPts — points for playing a match, awarded once per match
-- contested. Distinct from bonusPts, which is a single flat award per player
-- however many matches they play; in a weekly league where availability
-- varies, that difference is what makes turning up worth anything. Defaults
-- to 0 so no existing tournament starts paying an appearance point it never
-- asked for.
ALTER TABLE "Event" ADD COLUMN "playPts" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Match.forfeitedBy — the side that conceded, withdrew or failed to appear.
-- Covers Rule 3.2b(1) concession of a match, plus no-shows and withdrawals,
-- none of which could be recorded at all: an organizer's only options were to
-- invent a scoreline or leave the match Live forever. Holds a player id in an
-- individual round and a team id in a team round. Empty means it was played.
ALTER TABLE "Match" ADD COLUMN "forfeitedBy" TEXT NOT NULL DEFAULT '';
