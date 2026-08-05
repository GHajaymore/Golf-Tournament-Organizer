-- Introduce the billing tenant (Organization) that tournaments belong to.
--
-- Events previously had no owner above themselves, so a subscription had
-- nothing to attach to. This adds Organization / OrganizationMember /
-- Subscription and backfills every existing event to its organizer's personal
-- organization, so `Event.organizationId` can be NOT NULL from the start and
-- no tournament exists outside a billing boundary.

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'personal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'active',
    "provider" TEXT NOT NULL DEFAULT '',
    "providerCustomerId" TEXT,
    "providerSubscriptionId" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");
CREATE INDEX "OrganizationMember_organizationId_idx" ON "OrganizationMember"("organizationId");
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");

-- Add the tenant column nullable so existing rows can be backfilled before it
-- becomes mandatory.
ALTER TABLE "Event" ADD COLUMN "organizationId" TEXT;

--------------------------------------------------------------------------------
-- Backfill
--------------------------------------------------------------------------------

-- Temporary column carrying the organizer email each organization was created
-- for, so events and members can be joined back to it. Dropped at the end.
ALTER TABLE "Organization" ADD COLUMN "_seedEmail" TEXT;

-- One personal organization per distinct organizer (admin account email).
INSERT INTO "Organization" ("id", "name", "kind", "createdAt", "updatedAt", "_seedEmail")
SELECT
    gen_random_uuid()::text,
    COALESCE(NULLIF(MIN(a."name"), ''), a."email"),
    'personal',
    now(),
    now(),
    a."email"
FROM "Account" a
WHERE a."role" = 'admin'
GROUP BY a."email";

-- Point each event at the organization of one of its organizers.
UPDATE "Event" e
SET "organizationId" = o."id"
FROM "Account" a
JOIN "Organization" o ON o."_seedEmail" = a."email"
WHERE a."eventId" = e."id"
  AND a."role" = 'admin'
  AND e."organizationId" IS NULL;

-- Any event with no organizer at all still needs a tenant.
INSERT INTO "Organization" ("id", "name", "kind", "createdAt", "updatedAt", "_seedEmail")
SELECT gen_random_uuid()::text, 'Unassigned tournaments', 'personal', now(), now(), '__unassigned__'
WHERE EXISTS (SELECT 1 FROM "Event" WHERE "organizationId" IS NULL);

UPDATE "Event"
SET "organizationId" = (SELECT "id" FROM "Organization" WHERE "_seedEmail" = '__unassigned__')
WHERE "organizationId" IS NULL;

-- Make each organizer the owner of their organization, where a login identity
-- exists for that email. (Organizers provisioned but never signed in have no
-- User row yet; they become members when they claim their account.)
INSERT INTO "OrganizationMember" ("id", "organizationId", "userId", "role", "createdAt")
SELECT gen_random_uuid()::text, o."id", u."id", 'owner', now()
FROM "Organization" o
JOIN "User" u ON u."email" = o."_seedEmail";

-- Every organization gets a subscription row, free plan, so billing code
-- never has to handle "no subscription" as a special case.
INSERT INTO "Subscription" ("id", "organizationId", "plan", "status", "provider", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", 'free', 'active', '', now(), now()
FROM "Organization" o;

ALTER TABLE "Organization" DROP COLUMN "_seedEmail";

--------------------------------------------------------------------------------
-- Constraints (after backfill, so they can be enforced immediately)
--------------------------------------------------------------------------------

ALTER TABLE "Event" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "Event_organizationId_idx" ON "Event"("organizationId");

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
