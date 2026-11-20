-- CreateTable
CREATE TABLE "AiSpend" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "microUsd" INTEGER NOT NULL,
    "priced" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSpend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiSpend_month_idx" ON "AiSpend"("month");

