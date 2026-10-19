/**
 * The server's half of `matchKeptBy`: every write that can reach a match asks
 * this before it stores anything, so a round is never kept half one way and
 * half the other — the fault the setting exists to prevent (a stroke card
 * rebuilds a match over holes somebody tapped). One question, one sentence per
 * answer, whichever door the score came through.
 */
import { prisma } from "@/lib/db";
import { matchKeptBy, KEPT_BY_HOLES, KEPT_ON_CARDS, type MatchKeptBy } from "@/lib/domain/match-kept-by";

/** How this round's matches are kept, read from the stored round. */
export async function keptByForStage(stageId: string): Promise<MatchKeptBy | null> {
  const stage = await prisma.stage.findUnique({
    where: { id: stageId },
    select: { type: true, format: true, scoreInput: true, matchKeptBy: true },
  });
  return stage ? matchKeptBy(stage) : null;
}

/**
 * Null when a save of this kind may reach this round's matches, or the
 * sentence that says why not. A round with no matches has no rule here.
 */
export async function keptByRefusal(stageId: string, saving: MatchKeptBy): Promise<string | null> {
  const kept = await keptByForStage(stageId);
  if (kept === null || kept === saving) return null;
  return kept === "cards" ? KEPT_ON_CARDS : KEPT_BY_HOLES;
}
