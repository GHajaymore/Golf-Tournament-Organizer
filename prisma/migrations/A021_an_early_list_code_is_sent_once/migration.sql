-- An early-list code, sent (2026-10-23): who was sent which code, and when — one row per address.
-- CreateTable
CREATE TABLE "EarlyListSend" (
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'sending',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EarlyListSend_pkey" PRIMARY KEY ("email")
);

-- CreateIndex
CREATE INDEX "EarlyListSend_sentAt_idx" ON "EarlyListSend"("sentAt");
