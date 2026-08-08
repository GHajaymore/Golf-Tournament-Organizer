-- Who wrote a score down, and who signed it off.
--
-- confirmedById has existed since the confirmation flow was added and was
-- only ever written as null, so no result in the database can be traced to a
-- person. Names rather than ids because the card has to stay readable after a
-- member leaves the club and their row is gone.
ALTER TABLE "Match" ADD COLUMN "enteredBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Match" ADD COLUMN "confirmedBy" TEXT NOT NULL DEFAULT '';
