-- Multiple payers on one expense, and exact per-person amounts.
--
-- Both are additive and both are OPTIONAL, which is what makes this safe to
-- apply to a database full of real trips: an expense with no ExpensePayment
-- rows still means "paidBy paid the lot", and a share with a NULL amountCents
-- still splits by weight. Nothing that exists changes meaning.
--
-- Written idempotently — IF NOT EXISTS throughout, and the constraints guarded
-- by a catalogue lookup — because these migrations get re-applied by hand
-- against a database that must not be reset.

ALTER TABLE "ExpenseShare" ADD COLUMN IF NOT EXISTS "amountCents" INTEGER;

CREATE TABLE IF NOT EXISTS "ExpensePayment" (
    "id"          TEXT    NOT NULL,
    "expenseId"   TEXT    NOT NULL,
    "playerId"    TEXT    NOT NULL,
    "amountCents" INTEGER NOT NULL,
    CONSTRAINT "ExpensePayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExpensePayment_expenseId_playerId_key"
    ON "ExpensePayment" ("expenseId", "playerId");
CREATE INDEX IF NOT EXISTS "ExpensePayment_expenseId_idx"
    ON "ExpensePayment" ("expenseId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ExpensePayment_expenseId_fkey'
    ) THEN
        ALTER TABLE "ExpensePayment"
            ADD CONSTRAINT "ExpensePayment_expenseId_fkey"
            FOREIGN KEY ("expenseId") REFERENCES "Expense" ("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;
