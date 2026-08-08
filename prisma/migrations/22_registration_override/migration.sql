-- Explicitly closing or extending registration.
--
-- Nullable, and null means "follow the deadline" — so every existing
-- tournament keeps behaving exactly as its deadline says, with no backfill.
ALTER TABLE "Event" ADD COLUMN "registrationOverride" BOOLEAN;
