-- A NEW DEVICE PROVES ITSELF (2026-10-21).
--
-- The browsers each person has signed in on, by the hash of a random value the
-- browser keeps in a year-long cookie. Club staff signing in with a password on
-- a browser not listed here are emailed a six-digit code first; anybody signing
-- in on one is sent a "new sign-in" email (`services/known-device.ts`).
--
-- Starts empty on purpose: nobody's browser is known yet, so each person's next
-- password sign-in is their first on a known device. Sessions already open are
-- not touched.

-- CreateTable
CREATE TABLE "KnownDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnownDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnownDevice_userId_deviceHash_key" ON "KnownDevice"("userId", "deviceHash");

-- AddForeignKey
ALTER TABLE "KnownDevice" ADD CONSTRAINT "KnownDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
