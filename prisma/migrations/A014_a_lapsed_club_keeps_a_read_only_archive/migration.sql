-- A LAPSED PAID CLUB'S TOURNAMENTS ARE A READ-ONLY ARCHIVE FOR TWELVE MONTHS
-- (Ajay, 2026-10-21, decisions A4 and A8). See src/lib/domain/club-archive.ts.
--
-- Written by hand from `prisma migrate diff`; the diff also offered to drop the
-- email-verification and known-device tables, which belong to other branches'
-- migrations (A012, A013) and are not this one's to touch.

-- The instant the club's paid plan ended, and the two notices before the archive goes.
ALTER TABLE "Subscription" ADD COLUMN "lapsedAt" TIMESTAMP(3),
ADD COLUMN "archiveNotice30At" TIMESTAMP(3),
ADD COLUMN "archiveNotice7At" TIMESTAMP(3);

-- The same instant on every tournament the club held then.
ALTER TABLE "Event" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- A club whose Stripe plan had already ended before this rule existed was moved
-- to Par with a 30-day hold, after which Par's terms would delete its history.
-- It takes the archive instead: lapsed on the day its plan ended, which the old
-- webhook wrote into `currentPeriodEnd`. Only tournaments made before that day;
-- one made on Par since is an ordinary Par tournament.
UPDATE "Subscription"
SET "lapsedAt" = "currentPeriodEnd"
WHERE "status" = 'canceled' AND "provider" = 'stripe' AND "plan" = 'free' AND "currentPeriodEnd" IS NOT NULL;

UPDATE "Event" e
SET "archivedAt" = s."lapsedAt"
FROM "Subscription" s
WHERE s."organizationId" = e."organizationId"
  AND s."lapsedAt" IS NOT NULL
  AND e."createdAt" <= s."lapsedAt"
  AND e."archivedAt" IS NULL;
