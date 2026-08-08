-- AuditLog carried an `eventId` but no foreign key, so it was excluded from the
-- cascade when a tournament was deleted. That left orphaned rows behind which
-- still named the people involved (`actor`) and described their actions.
-- Deleting a tournament must purge everything belonging to it.

-- Remove any rows already orphaned by a previously deleted tournament. These
-- reference tournaments that no longer exist, so they are unreachable data and
-- would also violate the foreign key added below.
DELETE FROM "AuditLog"
WHERE "eventId" NOT IN (SELECT "id" FROM "Event");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
