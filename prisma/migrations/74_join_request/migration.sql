-- Somebody asking to be let into an outfit that is already here.
--
-- The other half of the same-name warning: it says "ask them to add you" and
-- then leaves them to find a phone number. One row per person per outfit, so
-- asking twice updates the first ask; a declined row is KEPT, because it is
-- what stops the same person asking forty times and because it records a
-- decision one person made about another.
CREATE TABLE "JoinRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT NOT NULL DEFAULT '',
    "decidedRole" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "JoinRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JoinRequest_organizationId_userId_key" ON "JoinRequest"("organizationId", "userId");
CREATE INDEX "JoinRequest_organizationId_status_idx" ON "JoinRequest"("organizationId", "status");
CREATE INDEX "JoinRequest_userId_idx" ON "JoinRequest"("userId");

ALTER TABLE "JoinRequest" ADD CONSTRAINT "JoinRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JoinRequest" ADD CONSTRAINT "JoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
