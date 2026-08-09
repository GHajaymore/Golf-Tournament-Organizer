-- Open (self-service) registration: an organizer shares a link and people
-- register themselves, no account required.
--
-- Additive only. Every existing event keeps its current behaviour: the token
-- is empty and registration is closed, so no tournament that never opted in
-- suddenly has a live public sign-up page.

-- Unguessable id for the public /register/[token] page. Minted like shareToken
-- (CSPRNG) when registration is first opened, then kept stable so a link that
-- has already been shared keeps resolving. Empty until then.
ALTER TABLE "Event" ADD COLUMN "registrationToken" TEXT NOT NULL DEFAULT '';

-- The switch. While false the public link is indistinguishable from a bogus
-- one — closing registration must not confirm that a tournament exists.
ALTER TABLE "Event" ADD COLUMN "registrationOpen" BOOLEAN NOT NULL DEFAULT false;

-- auto  — fill to capacity as confirmed, overflow to the waitlist.
-- approve — every entry lands pending for the organizer to accept.
ALTER TABLE "Event" ADD COLUMN "registrationApproval" TEXT NOT NULL DEFAULT 'auto';

-- Tokens must be unique so a lookup resolves one event — but a plain unique
-- index would make the empty default collide across every event that has never
-- opened registration. A partial index constrains only real tokens, exactly as
-- Stage.accessCode does for the same reason.
CREATE UNIQUE INDEX "Event_registrationToken_key" ON "Event"("registrationToken") WHERE "registrationToken" <> '';
