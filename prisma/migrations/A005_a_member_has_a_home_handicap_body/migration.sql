-- A member's own handicap body, for a visitor whose index is with another country's body (2026-10-17).
-- Empty for every existing member: their body is the club's.
ALTER TABLE "Member" ADD COLUMN "handicapBodyId" TEXT NOT NULL DEFAULT '';
