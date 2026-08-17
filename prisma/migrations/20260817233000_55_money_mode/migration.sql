-- What a tournament does with money — none, float, or split.
--
-- There were two behaviours and no way to choose between them: the ledger
-- appeared once somebody entered a line, so a society that settles at the bar
-- saw a settle-up nobody asked for, and one that had entered nothing could not
-- tell whether the feature existed.
--
-- Both columns default to empty, meaning "follow the level above" — the
-- tournament follows the club, the club follows the kind of outfit it is. So
-- every organization keeps behaving exactly as it does today until somebody
-- chooses otherwise.
ALTER TABLE "Organization" ADD COLUMN "moneyMode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Event"        ADD COLUMN "moneyMode" TEXT NOT NULL DEFAULT '';

-- The float: fees in, prizes and the celebration out.
--
-- Not an Expense with a negative amount. The split ledger divides amounts
-- between players and a negative there would silently invert a debt, so the
-- direction is its own column and cannot be mistaken for a discount.
CREATE TABLE "TournamentFund" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL DEFAULT '',
    "direction" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "occurredOn" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentFund_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TournamentFund_eventId_stageId_idx" ON "TournamentFund"("eventId", "stageId");

ALTER TABLE "TournamentFund" ADD CONSTRAINT "TournamentFund_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
