-- A RATE IS NEVER OVERWRITTEN (B44 review, 13 Nov 2026): a new dated row each time, a wrong one voided with a reason.
-- A043: A042 is applied and is not edited. The one-row-per-day unique index is dropped so a replaced rate can stay as
-- a voided row beside its replacement; two columns say when and why. Nothing is deleted or rewritten.

-- DropIndex
DROP INDEX "FxRate_currency_rateDate_source_key";

-- AlterTable
ALTER TABLE "FxRate" ADD COLUMN     "voidReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "voidedAt" TIMESTAMP(3);
