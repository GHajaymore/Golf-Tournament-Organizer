import { prisma } from "@/lib/db";

/**
 * How many cards a round already holds.
 *
 * Asked before anything that RE-SCORES a round rather than edits it. Changing
 * a round's venue or its format does not touch a single stored stroke — and
 * that is exactly why it is dangerous. Every number stays where it is and the
 * results computed from them change underneath: a different stroke index puts
 * the handicap shots on different holes, a different format counts the same
 * strokes a different way, and nothing on any screen says a thing.
 *
 * The app already refuses-then-reports for a field resize, which DELETES
 * scored matches. This is the quieter cousin: nothing is deleted, so there is
 * no gap to notice afterwards.
 *
 * Counts rows that hold strokes, across the three places a round's scores can
 * live. A row with no strokes on it is not a card somebody returned — it is a
 * placeholder — so it is not counted, and an untouched round reports zero and
 * changes without a fuss.
 */
export async function enteredCardCount(eventId: string, stageId?: string): Promise<number> {
  /**
   * Omit the round to ask about the WHOLE EVENT.
   *
   * Added for the destructive organizer actions — regenerating flights,
   * resizing the field — which until now asked `scoredMatchCount`, and that
   * counted Round Robin matches and nothing else. For a medal, a knockout, a
   * team event or a bracket it returned zero, so the "this will destroy
   * results" confirmation never appeared and certified cards were discarded in
   * silence.
   *
   * This function already unions every place a score can live, and its own
   * header calls the resize guard "the app already refuses-then-reports". It
   * did not: it refused on a count that could not see most of the app. Asking
   * one question of one place is the point.
   */
  const round = stageId ? { stageId } : {};
  const throughMatch = stageId ? { match: { stageId } } : {};

  const [stroke, team, match, matchHoles] = await Promise.all([
    prisma.scorecard.findMany({
      where: { eventId, ...round },
      select: { strokes: true },
    }),
    prisma.teamScorecard.findMany({
      where: { eventId, ...round },
      select: { strokes: true },
    }),
    // Match cards are keyed on the match, so the round is reached through it.
    prisma.matchScorecard.findMany({
      where: { eventId, ...throughMatch },
      select: { strokes: true },
    }),
    /**
     * Match play does not store strokes at all.
     *
     * A hole-by-hole result or a final margin lives on the Match itself, so
     * counting only stroke blobs reported ZERO for a match-play round with
     * forty-eight results in it — and the change it was meant to guard sailed
     * through. Found by pointing the guard at a real round rather than by
     * reading it back.
     */
    prisma.match.findMany({
      where: stageId ? { stageId } : { eventId },
      select: { holes: true },
    }),
  ]);

  const cards = [...stroke, ...team, ...match].filter((r) => hasAStroke(r.strokes)).length;
  const results = matchHoles.filter((m) => hasAResult(m.holes)).length;
  return cards + results;
}

/**
 * Whether a stored strokes blob holds an actual score.
 *
 * `"[]"`, `"[null,null,...]"` and unparseable rubbish all mean "nobody has
 * written anything here". Treating those as cards would make an untouched
 * round refuse to have its venue set, which is the one moment setting it is
 * completely safe.
 */
function hasAStroke(json: string): boolean {
  try {
    const arr = JSON.parse(json) as unknown;
    return Array.isArray(arr) && arr.some((v) => typeof v === "number" && v > 0);
  } catch {
    return false;
  }
}


/**
 * Whether a match holds a per-hole result.
 *
 * The array holds "A" | "B" | "H" | null, so the stroke check above — which
 * looks for a positive NUMBER — sees nothing in it. Two shapes of score, two
 * readers; one reader would have quietly meant "no scores here".
 */
function hasAResult(json: string): boolean {
  try {
    const arr = JSON.parse(json) as unknown;
    return Array.isArray(arr) && arr.some((v) => typeof v === "string" && v.trim() !== "");
  } catch {
    return false;
  }
}