-- Per-tournament settings for how players see standings and report scores.
--
-- There is no single right answer: a club championship runs blind with the
-- committee entering every card, a society wants players scoring live on their
-- phones, a member-guest wants a link the clubhouse can watch. Communities
-- often have several organizers who each run events differently, so the
-- tournament owns the choice.
--
-- Every default below reproduces the behaviour the app had before these
-- columns existed, with one deliberate exception noted at scoreApproval.

-- Organizations carry house defaults that new tournaments copy.
ALTER TABLE "Organization"
    ADD COLUMN "defaultLeaderboardVisibility" TEXT NOT NULL DEFAULT 'participants',
    ADD COLUMN "defaultScoreEntryBy"          TEXT NOT NULL DEFAULT 'players',
    ADD COLUMN "defaultScoreEntryWindow"      TEXT NOT NULL DEFAULT 'during',
    ADD COLUMN "defaultVoiceEntry"            BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "defaultPlayerAccess"          TEXT NOT NULL DEFAULT 'email',
    ADD COLUMN "defaultScoreApproval"         TEXT NOT NULL DEFAULT 'staff';

-- The tournament's own copy. Deliberately a copy, not a lookup: changing a
-- house default must never alter the rules of an event already under way.
--
-- scoreApproval defaults to 'staff' rather than matching prior behaviour. The
-- app previously auto-confirmed any pending score after 24 hours with no
-- review, which silently locks results nobody checked. Organizers who want
-- that back can set 'players' per tournament.
ALTER TABLE "Event"
    ADD COLUMN "leaderboardVisibility" TEXT NOT NULL DEFAULT 'participants',
    ADD COLUMN "scoreEntryBy"          TEXT NOT NULL DEFAULT 'players',
    ADD COLUMN "scoreEntryWindow"      TEXT NOT NULL DEFAULT 'during',
    ADD COLUMN "voiceEntry"            BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "playerAccess"          TEXT NOT NULL DEFAULT 'email',
    ADD COLUMN "scoreApproval"         TEXT NOT NULL DEFAULT 'staff',
    ADD COLUMN "shareToken"            TEXT;

-- Backfill a share token for every existing tournament.
--
-- Derived from gen_random_uuid() rather than the application's alphabet
-- because it is evaluated per row and unique by construction; an uncorrelated
-- random subquery would be computed once and hand every tournament the same
-- token. A share token is only ever tapped from a link, never read aloud, so
-- its shape does not matter — only that it is opaque and unique.
UPDATE "Event"
SET "shareToken" = upper(replace(gen_random_uuid()::text, '-', ''))
WHERE "shareToken" IS NULL;

ALTER TABLE "Event" ALTER COLUMN "shareToken" SET NOT NULL;
CREATE UNIQUE INDEX "Event_shareToken_key" ON "Event"("shareToken");

-- Round Codes live on the round, not the player: one code announced on the
-- first tee beats forty printed slips, and a twelve-round league gets twelve
-- codes with last week's going dead. Empty until code access is switched on,
-- so an event that never wanted them carries no standing credentials.
ALTER TABLE "Stage" ADD COLUMN "accessCode" TEXT NOT NULL DEFAULT '';

-- Redemption looks a code up on its own, so codes must be unique globally.
-- Partial, because the empty default is the common case and would otherwise
-- collide for every round without one.
CREATE UNIQUE INDEX "Stage_accessCode_key"
    ON "Stage"("accessCode")
    WHERE "accessCode" <> '';
