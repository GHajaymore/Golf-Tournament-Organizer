-- Two settings that were each half a feature.
--
-- cutScope: the cut line could only take the top N across the whole field,
-- while a separate tournament-level "qualification" setting had per-flight but
-- no percentage. "overall" is what every existing round already does.
--
-- deadlineOverride: a round's completion deadline was a label that enforced
-- nothing. Null follows the date, so nothing changes until someone decides.
ALTER TABLE "Stage" ADD COLUMN "cutScope" TEXT NOT NULL DEFAULT 'overall';
ALTER TABLE "Stage" ADD COLUMN "deadlineOverride" BOOLEAN;
