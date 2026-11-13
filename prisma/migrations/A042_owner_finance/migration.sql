-- OWNER P&L (B44, 12 Nov 2026): the platform's own books, read by the owners only.
-- A042: additive only, three new tables and their indexes; nothing existing is touched. Money is stored in
-- minor units of the currency charged or paid; US dollars are worked at read time from a dated FxRate.
-- No player, member or club name in any column.

-- CreateTable
CREATE TABLE "CostEntry" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "vendor" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "cadence" TEXT NOT NULL DEFAULT 'once',
    "endsMonth" TEXT,
    "source" TEXT NOT NULL DEFAULT 'typed',
    "note" TEXT NOT NULL DEFAULT '',
    "enteredByEmail" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT NOT NULL DEFAULT '',
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "rateDate" TEXT NOT NULL,
    "usdMicrosPerUnit" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'override',
    "reason" TEXT NOT NULL DEFAULT '',
    "enteredByEmail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "kind" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT '',
    "providerRef" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "listMinor" INTEGER NOT NULL DEFAULT 0,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "feeMinor" INTEGER NOT NULL DEFAULT 0,
    "feeCurrency" TEXT NOT NULL DEFAULT '',
    "usdSettledMinor" INTEGER,
    "servicePeriodStart" TEXT NOT NULL DEFAULT '',
    "servicePeriodEnd" TEXT NOT NULL DEFAULT '',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "refundOf" TEXT,
    "region" TEXT NOT NULL DEFAULT '',
    "discountCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostEntry_month_idx" ON "CostEntry"("month");

-- CreateIndex
CREATE INDEX "CostEntry_supersedesId_idx" ON "CostEntry"("supersedesId");

-- CreateIndex
CREATE INDEX "FxRate_currency_rateDate_idx" ON "FxRate"("currency", "rateDate");

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_currency_rateDate_source_key" ON "FxRate"("currency", "rateDate", "source");

-- CreateIndex
CREATE UNIQUE INDEX "BillingRecord_providerRef_key" ON "BillingRecord"("providerRef");

-- CreateIndex
CREATE INDEX "BillingRecord_organizationId_idx" ON "BillingRecord"("organizationId");

-- CreateIndex
CREATE INDEX "BillingRecord_paidAt_idx" ON "BillingRecord"("paidAt");

