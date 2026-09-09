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

/** One player's strokes for one round, whichever table they were stored in. */
export type PlayerStrokes = { playerId: string; stageId: string; strokes: string };

/**
 * EVERY STROKE A ROUND HOLDS, KEYED BY THE PLAYER WHO PLAYED IT.
 *
 * The counterpart to `enteredCardCount` above: that answers "how many cards
 * are there", this answers "whose, and what is on them". Both exist because a
 * round's scores live in THREE tables and no single one of them is the round.
 *
 *   Scorecard       a stroke round. One row per player.
 *   MatchScorecard  a match round played on full gross cards. One row per SIDE
 *                   of a fixture, keyed "A" or "B", reached through the match.
 *   TeamScorecard   a team round. One row per player — it carries its own
 *                   `playerId`, which is what makes a four-ball readable here.
 *
 * WHY THIS IS A FUNCTION RATHER THAN A QUERY EACH TIME. Every money reader
 * that asked `prisma.scorecard.findMany` alone was silently asking "what did
 * the STROKE players do", and answering nothing on a round that was not one.
 * Two of them were found that way and fixed in place, one at a time:
 *
 *   2026-09-08  a skins pot on a match-play round read zero cards and said
 *               "0 skins · provisional" for ever. £10 in a game that could
 *               not be decided.
 *   2026-09-08  the same pot on a FOUR-BALL, on the wrong assumption that a
 *               team card names no player. It does.
 *   2026-09-09  the derived pots — birdies, eagles, low gross, low net — in
 *               `expenses.ts`, which had never been asked the question at all
 *               and reasoned in a comment that a match round "has nothing to
 *               pay either way". That was true while a match round could not
 *               hold gross cards and stopped being true when it could.
 *
 * A third caller written later must not have to rediscover this, so the rule
 * lives where the data is built rather than in a comment at each sink — the
 * shape `standingRows` uses for manual formats, and for the same reason.
 *
 * GAP-FILLING, IN THAT ORDER, WHICH IS THE PROPERTY THAT MAKES IT SAFE TO PUT
 * UNDER MONEY. A player who already has a card keeps it: the later sources
 * only reach a (round, player) that had nothing. So a stroke round reads
 * exactly as it did before — it holds no rows in the other two tables at all —
 * and nothing that settles today can change its answer.
 *
 * FOURSOMES STAYS OUT, for a reason about golf rather than about storage.
 * Partners play one ball, so the side returns ONE card with nobody's id on it.
 * There is no individual score to attribute, and inventing one would pay a
 * skin to a player who never hit the shot.
 */
export async function roundStrokes(eventId: string, stageId?: string): Promise<PlayerStrokes[]> {
  const round = stageId ? { stageId } : {};

  const [stroke, match, team] = await Promise.all([
    prisma.scorecard.findMany({
      where: { eventId, ...round },
      select: { playerId: true, stageId: true, strokes: true },
    }),
    /**
     * Match cards are keyed on the FIXTURE, so both the round and the player
     * are reached through it. Slot "A" is the match's `playerAId`, "B" its
     * `playerBId` — and a TEAM fixture leaves both empty, which is what keeps
     * a foursome's single card from being filed under somebody.
     */
    prisma.matchScorecard.findMany({
      where: { eventId, ...(stageId ? { match: { stageId } } : {}) },
      select: {
        slot: true,
        strokes: true,
        match: { select: { stageId: true, playerAId: true, playerBId: true } },
      },
    }),
    prisma.teamScorecard.findMany({
      where: { eventId, ...round },
      select: { playerId: true, stageId: true, strokes: true },
    }),
  ]);

  const seen = new Set<string>();
  const out: PlayerStrokes[] = [];
  const take = (playerId: string | null, stage: string, strokes: string) => {
    // An empty id is not a player. It is what a team fixture stores, and a
    // strokes list keyed on "" is a junk row every later reader then has to
    // reason about — cheaper to refuse it here than to explain it there.
    if (!playerId) return;
    const key = `${stage}:${playerId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ playerId, stageId: stage, strokes });
  };

  for (const c of stroke) take(c.playerId, c.stageId, c.strokes);
  for (const c of match) {
    take(c.slot === "A" ? c.match.playerAId : c.match.playerBId, c.match.stageId, c.strokes);
  }
  for (const c of team) take(c.playerId, c.stageId, c.strokes);
  return out;
}
