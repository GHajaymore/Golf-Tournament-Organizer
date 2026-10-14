-- A round records when a stroke cut was first made into it (2026-10-14).
--
-- Nothing recorded that a cut had been made. Every reader inferred it from
-- whether the round held cards, which a card somebody STARTED while the round
-- before was still open also satisfies: one card in round 2 made its player
-- the whole field, and anybody who teed off before round 1 was closed came
-- through any cut. `cutHasBeenMade` now reads this column.
--
-- THE NAME: folders replay in text order, and "100_" sorts before "10_". A
-- capital letter sorts after every digit, so A000 to A999 follow 99_; the
-- order is held by `migrations-replay-in-the-order-written.test.ts`.
--
-- Back-filled with exactly the condition the readers used until now — a cut
-- round whose round before is closed and which holds a card — dated when that
-- round was closed, so every cut already made reads as made and nothing on any
-- board moves. A round that does not meet it keeps NULL. Adds a column and
-- updates rows that exist; safe on an empty table and on a populated one.
ALTER TABLE "Stage" ADD COLUMN "cutMadeAt" TIMESTAMP(3);

UPDATE "Stage" AS s
SET "cutMadeAt" = feeder."closedAt"
FROM "Stage" AS feeder
WHERE s."cutEnabled" = true
  AND feeder."eventId" = s."eventId"
  AND feeder."closedAt" IS NOT NULL
  AND feeder."position" = (
    SELECT MAX(p."position") FROM "Stage" AS p
    WHERE p."eventId" = s."eventId"
      AND p."position" < s."position"
      AND p."type" IN ('Round Robin', 'Stroke Play Round', 'Single Match Stage', 'Bracket Stage', 'Team Session')
  )
  AND EXISTS (SELECT 1 FROM "Scorecard" AS c WHERE c."stageId" = s."id");
