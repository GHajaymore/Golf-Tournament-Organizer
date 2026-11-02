-- AN ADDRESS IS PROVED BEFORE IT SIGNS IN (2026-10-21).
--
-- `createSession` makes no session for a User whose `emailVerifiedAt` is NULL.
-- A six-digit code (`EmailCode`) or a finished password reset sets it.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- Everybody who could already sign in keeps signing in: every User holding a
-- password today is a test, demo or owner account (production is held until
-- launch), and they chose that password before there was a code to type. A
-- User with no password (invited, never claimed) stays unproved, which is the
-- whole point: they prove the address when they claim it.
UPDATE "User" SET "emailVerifiedAt" = CURRENT_TIMESTAMP WHERE "password" <> '';

-- CreateTable
CREATE TABLE "EmailCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "pending" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailCode_userId_browserHash_idx" ON "EmailCode"("userId", "browserHash");

-- AddForeignKey
ALTER TABLE "EmailCode" ADD CONSTRAINT "EmailCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
