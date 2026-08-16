-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "currencySymbol" TEXT NOT NULL DEFAULT '$',
ADD COLUMN     "smsRateMicros" INTEGER NOT NULL DEFAULT 0;
