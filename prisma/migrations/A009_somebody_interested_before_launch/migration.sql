-- Somebody interested before launch (2026-10-21): the public /interest form.
-- Additive: one new table, empty.
CREATE TABLE "InterestRequest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "club" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT '',
    "members" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterestRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InterestRequest_createdAt_idx" ON "InterestRequest"("createdAt");
