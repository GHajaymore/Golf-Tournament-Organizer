/**
 * The boundary for the league's writes arriving from a browser (B115b), beside `league-draw-payload.ts`.
 *
 * `nominatePair`, `withdrawPair` and `setPlayoffHoleWinner` are typed with strings and an array of strings, and every
 * one of those types is ERASED at runtime: a server action is a public HTTP endpoint, so what arrives is whatever the
 * caller sent. A `playerIds` that is not an array went into `{ in: playerIds }` (a Prisma throw, which a person reads as
 * "This screen didn't load"), and the play-off override's reason was `.trim()`ed with no type check and stored and
 * printed for members with no ceiling.
 *
 * Same discipline as `league-draw-payload.ts` and `score-payload.ts`: parse rather than trust, refuse rather than
 * repair, and a refusal is words for the person, never a throw.
 */

/** A cuid is 25 characters; anything past this is not an id. */
const MAX_ID_LENGTH = 64;
/** The play-off override's reason, as long as a committee correction's (`CORRECTION_REASON.max`). */
export const LEAGUE_REASON = { min: 3, max: 200 } as const;

const isId = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && v.length <= MAX_ID_LENGTH;

export type CleanResult<T> = { ok: true; value: T } | { ok: false; error: string };

const NOT_UNDERSTOOD = "That request was not understood. Reload the page and try again.";

/** A pair nominated: a round, a club, and an array of at most two player ids. */
export function cleanNomination(
  stageId: unknown,
  clubId: unknown,
  playerIds: unknown,
): CleanResult<{ stageId: string; clubId: string; playerIds: string[] }> {
  if (!isId(stageId) || !isId(clubId)) return { ok: false, error: NOT_UNDERSTOOD };
  if (!Array.isArray(playerIds) || playerIds.length > 2 || !playerIds.every(isId)) {
    return { ok: false, error: "A pair is two players." };
  }
  return { ok: true, value: { stageId, clubId, playerIds: [...playerIds] } };
}

/** A pair taken down: its id. */
export function cleanPairId(pairId: unknown): CleanResult<string> {
  return isId(pairId) ? { ok: true, value: pairId } : { ok: false, error: NOT_UNDERSTOOD };
}

/** A play-off hole recorded: four ids and, to overturn a played result, a reason of 3 to 200 characters. */
export function cleanPlayoffDecision(
  stageId: unknown,
  clubAId: unknown,
  clubBId: unknown,
  winnerId: unknown,
  override: unknown,
): CleanResult<{ stageId: string; clubAId: string; clubBId: string; winnerId: string; override: { reason: string } | undefined }> {
  if (!isId(stageId) || !isId(clubAId) || !isId(clubBId) || !isId(winnerId)) return { ok: false, error: NOT_UNDERSTOOD };
  if (override === undefined || override === null) {
    return { ok: true, value: { stageId, clubAId, clubBId, winnerId, override: undefined } };
  }
  const reason = typeof override === "object" ? (override as { reason?: unknown }).reason : undefined;
  if (typeof reason !== "string") return { ok: false, error: "Say why the committee is overturning the result." };
  if (reason.trim().length > LEAGUE_REASON.max) {
    return { ok: false, error: `The reason is at most ${LEAGUE_REASON.max} characters.` };
  }
  return { ok: true, value: { stageId, clubAId, clubBId, winnerId, override: { reason } } };
}
