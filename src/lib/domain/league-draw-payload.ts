/**
 * The boundary for a league-week draw arriving from a browser (B124).
 *
 * `drawLeagueWeek(stageId, replace, shortSeason)` is typed `(string, boolean, boolean)` and every one of those types is
 * ERASED at runtime: a server action is a public HTTP endpoint, so what arrives is whatever the caller sent. `replace` is
 * the word that lets a draw DELETE a drawn week, so it must be exactly `true` to mean yes (a string "false" is truthy and
 * would have replaced the week), and `stageId` goes into a database lookup, so it must be a real-looking id.
 *
 * Same discipline as `score-payload.ts`: parse rather than trust, and refuse rather than repair. A refusal is words for
 * the person, never a throw (a throw is "This screen didn't load").
 */

/** A cuid is 25 characters; anything past this is not an id. */
const MAX_ID_LENGTH = 64;

export interface LeagueDrawRequest {
  stageId: string;
  replace: boolean;
  shortSeason: boolean;
}

export type LeagueDrawRequestResult = { ok: true; request: LeagueDrawRequest } | { ok: false; error: string };

const optionalFlag = (v: unknown): boolean | null => (v === undefined ? false : typeof v === "boolean" ? v : null);

export function cleanLeagueDrawRequest(stageId: unknown, replace: unknown, shortSeason: unknown): LeagueDrawRequestResult {
  if (typeof stageId !== "string" || stageId.trim() === "" || stageId.length > MAX_ID_LENGTH) {
    return { ok: false, error: "Choose which round to draw." };
  }
  const r = optionalFlag(replace);
  const s = optionalFlag(shortSeason);
  if (r === null || s === null) {
    return { ok: false, error: "That draw request was not understood. Reload the page and try again." };
  }
  return { ok: true, request: { stageId, replace: r, shortSeason: s } };
}
