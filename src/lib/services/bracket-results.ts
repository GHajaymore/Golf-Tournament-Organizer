import { prisma } from "@/lib/db";

/**
 * The score each decided knockout tie was won by ("3&2"), keyed by slot.
 *
 * Who went through is already on `EventState.brackets`; the margin is the
 * one part of a `BracketWinner` row the draw does not carry, and a result
 * without its margin is half a result to the member reading it.
 */
export async function bracketResults(eventId: string): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  for (const w of await prisma.bracketWinner.findMany({
    where: { eventId },
    select: { key: true, result: true },
  })) {
    if (w.result) results[w.key] = w.result;
  }
  return results;
}
