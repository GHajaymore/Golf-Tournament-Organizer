-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "currencyOverride" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "localeOverride" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en-US';
