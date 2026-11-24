import { relocate, type ScreenKey } from "./console-merges";
import type { Role } from "../roles";

/**
 * WHERE THE GROUPS' GAMES ARE DRAWN FOR THIS PERSON (R8b), asked of the one rule that says where an old door leads: `relocate`
 * (the `MOVES` row for `/group-games`: an admin or assistant, never a casual round, once Winners & money is shown). It is not
 * written a second time here. Both pages ask it, so `GroupGames` is mounted once:
 *
 *   - `/group-games` draws its body unless this answers an address, and then says where it went (the old door still OPENS, as
 *     `lifecycle-menu.spec` holds every old door to);
 *   - `/money` draws the section only when this answers an address, and otherwise points back at `/group-games`.
 *
 * `round` is the round asked for, carried on to the new address as `relocate` carries any query. Null means "not moved".
 */
export function groupGamesMovedTo(role: Role, casual: boolean, shown: ReadonlySet<ScreenKey>, round?: string): string | null {
  const href = round ? `/group-games?round=${encodeURIComponent(round)}` : "/group-games";
  const to = relocate({ href, role, casual }, shown);
  return to === href ? null : to;
}
