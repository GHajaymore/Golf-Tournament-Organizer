-- Attempt counters for the three endpoints reachable without a session.
--
-- These were counted in process memory, which on serverless hosting is close
-- to no limit at all: instances are per-request and cold-start constantly, so
-- "10 attempts per 15 minutes" was really "10 per warm instance", and someone
-- guessing round codes in parallel got a fresh budget most requests. A
-- redeemed round code hands over a whole field's names and scores, so the
-- counter has to be shared to be worth anything.
--
-- The key is kind:sha256(identifier):window — no readable email address and no
-- live round code is stored. It is the primary key so an attempt is one atomic
-- "insert or add one" with no read to race against. Rows past expiresAt are
-- ignored and swept on write; the index is for that sweep.
CREATE TABLE "RateLimitHit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "RateLimitHit_expiresAt_idx" ON "RateLimitHit"("expiresAt");
