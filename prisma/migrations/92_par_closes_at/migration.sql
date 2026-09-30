-- A Par tournament's own closing time: stamped once by the daily sweep when
-- its golf begins, never moved. Null on every existing row.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "closesAt" TIMESTAMP(3);
