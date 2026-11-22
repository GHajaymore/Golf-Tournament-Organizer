import { ROOMS, SCREEN_KEYS } from "./console-merges";

/**
 * WHERE A PERSON WAS SENT FROM, as a screen's own address, or null (R2).
 *
 * A screen reached from another room (Courses, sent from a round's card note) can offer "Back to ‹that
 * screen›". The place arrives off the query string, so it is NEVER followed as given: it is read only
 * as one of the console's own addresses (`ROOMS[*].paths`), compared WHOLE, and what comes back is that
 * known address and nothing else, never what the link said. A link to another site, a scheme, a
 * protocol-relative `//host`, a path that is not a screen, or one carrying anything past the path's own
 * query or `#place` is null, and the screen then draws no way back. The screen's own address is null
 * too: "back" to where you are is no way back.
 *
 * Pure. The caller names the address (`screenName`) and draws the link.
 */
export function cameFromPath(from: string | undefined | null, own: string): string | null {
  if (typeof from !== "string" || from.length === 0 || from.length > 200) return null;
  const path = from.split(/[?#]/)[0];
  if (path === own) return null;
  return SCREEN_KEYS.some((k) => ROOMS[k].paths.includes(path)) ? path : null;
}
