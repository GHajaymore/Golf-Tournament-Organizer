-- A CLUB WITH THE SAME NAME WAS SET UP NEARBY: THE ONE THAT WAS HERE FIRST IS TOLD (Ajay, 7 Nov 2026).
--
-- A041: A039 and A040 belong to open branches (#1047, #1051).
-- Additive only: one new table, nothing existing is touched. A notice holds the new club's name, its
-- town and the NAME of whoever set it up, and nothing else (no email, phone, roster or tournament).

CREATE TABLE "NamesakeNotice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "newOrganizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "town" TEXT NOT NULL DEFAULT '',
    "byName" TEXT NOT NULL DEFAULT '',
    "how" TEXT NOT NULL DEFAULT 'new',
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),
    "dismissedBy" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "NamesakeNotice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NamesakeNotice_organizationId_status_idx" ON "NamesakeNotice"("organizationId", "status");

CREATE UNIQUE INDEX "NamesakeNotice_organizationId_newOrganizationId_key" ON "NamesakeNotice"("organizationId", "newOrganizationId");

ALTER TABLE "NamesakeNotice" ADD CONSTRAINT "NamesakeNotice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NamesakeNotice" ADD CONSTRAINT "NamesakeNotice_newOrganizationId_fkey" FOREIGN KEY ("newOrganizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
