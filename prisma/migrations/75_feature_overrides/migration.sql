-- One club's exceptions to its tier, as JSON: {"honours": true}.
--
-- The dynamic half of feature gating. A tier is a rule about a class of
-- customers; this is the answer for one of them — grandfathering a club that
-- had a capability before it was priced, trialling one, or switching one off
-- for a single tenant without a deploy.
--
-- Empty string means "no exceptions", which is every row today.
ALTER TABLE "Subscription" ADD COLUMN "featureOverrides" TEXT NOT NULL DEFAULT '';
