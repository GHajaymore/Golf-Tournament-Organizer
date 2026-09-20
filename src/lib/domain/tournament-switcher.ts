import { byBand, type EventBand } from "./club-event-card";

/**
 * WHICH TOURNAMENT THE PLAY SHELL IS SHOWING, AND WHERE ELSE A MEMBER CAN GO.
 *
 * The club's request of 2026-09-18: a member can move between the club's
 * tournaments, including the ones they have not entered, and everything is
 * read-only except their own inputs. The shell always rendered ONE tournament
 * — whichever `setActiveEvent` last chose — and never said which, so a member
 * who opened a friend's board from the events list was then looking at a
 * header that said nothing about why their card had gone.
 *
 * Pure, so the rules are tested without a database. The rows are the ones
 * `clubEventsFor` already built for the events list, so the switcher cannot
 * offer a tournament that list would refuse to open, or call one open that
 * the list calls shut.
 */

export interface SwitchableRow {
  eventId: string;
  name: string;
  band: EventBand;
  bandLabel: string;
  entered: boolean;
  /**
   * ON THE WAITING LIST — which is neither entered nor a spectator.
   *
   * `entered` means CONFIRMED, the rule every card guard uses, so without this
   * a member waiting for a place fell into the same branch as a stranger
   * reading somebody else's tournament. Optional so a caller without it
   * behaves exactly as before.
   */
  waiting?: boolean;
  canView: boolean;
  /**
   * The organizer’s lifecycle word — "live" is how the switcher tells a
   * player which of their tournaments is being played now. Optional so a
   * caller without it behaves as before.
   */
  eventStatus?: string;
}

export interface SwitcherEntry {
  eventId: string;
  name: string;
  /** "You’re in · On now", "Watching · Results" — one line under the name. */
  note: string;
}

export interface Switcher {
  /** The tournament on screen, or null when the list does not hold it. */
  current: (SwitcherEntry & { watching: boolean; waiting: boolean }) | null;
  /** Everywhere else worth going, in the events list's own order. */
  others: SwitcherEntry[];
}

/**
 * WATCHING is a member looking at a tournament they are not in. It is never
 * said of staff: an organizer checking the player view is running the thing,
 * not spectating it, and "read-only" would be false for them anyway.
 */
export function isWatching(
  row: Pick<SwitchableRow, "entered" | "waiting"> | null,
  isStaff: boolean,
): boolean {
  return !!row && !row.entered && !row.waiting && !isStaff;
}

/**
 * WAITING is a member who put their name down and has not been given a place.
 *
 * Separated from watching on 2026-09-20 because one question was answering
 * for two people. `entered` means CONFIRMED — the rule `myPlayerIds` and every
 * card guard use, and rightly, since a waitlisted entry must not be handed a
 * card — so `!entered` swept up the applicant along with the spectator, and
 * the player's Today told somebody on the list "You aren't entered in this
 * tournament". Measured on the seeded club's Am-Am: the events list said
 * "You’re on the waiting list — the organizer will confirm your place" on the
 * very row Today was reading when it said the opposite.
 *
 * Staff are excluded here for the same reason as above: an organizer checking
 * the player view is running the thing.
 */
export function isWaiting(
  row: Pick<SwitchableRow, "entered" | "waiting"> | null,
  isStaff: boolean,
): boolean {
  return !!row && !row.entered && !!row.waiting && !isStaff;
}

function noteOf(row: SwitchableRow, isStaff: boolean): string {
  // The "entered" band's label IS "You’re in", so it is not said twice. A
  // finished band says "Finished" whether they played or not, so who they
  // were in it comes first — and "Waiting list" comes before "Watching",
  // because a member who applied is not a spectator and this line is the only
  // thing on the switcher that is about THEM.
  const who = row.entered ? "You’re in" : row.waiting && !isStaff ? "Waiting list" : isStaff ? "" : "Watching";
  // A tournament the player is IN and that is live is the one they are
  // playing — said in those words, because a player entered in three needs to
  // know which one their card belongs to today.
  const what = row.band === "entered" ? (row.eventStatus === "live" ? "Playing now" : "") : row.bandLabel;
  return [who, what].filter(Boolean).join(" · ");
}

export function switcherFor(rows: readonly SwitchableRow[], activeId: string | null, isStaff: boolean): Switcher {
  const active = rows.find((r) => r.eventId === activeId) ?? null;
  /**
   * A row is somewhere to go if the member is in it, or if there is something
   * on it to look at. A draft with no cards is left out for the same reason
   * the events list offers it no board: an empty table reads as a broken link.
   */
  const others = playingFirst(byBand(rows.filter((r) => r.eventId !== activeId && (r.entered || r.canView)))).map((r) => ({
    eventId: r.eventId,
    name: r.name,
    note: noteOf(r, isStaff),
  }));
  return {
    current: active
      ? {
          eventId: active.eventId,
          name: active.name,
          note: noteOf(active, isStaff),
          watching: isWatching(active, isStaff),
          waiting: isWaiting(active, isStaff),
        }
      : null,
    others,
  };
}

/**
 * Within the player’s own tournaments, the one being played now comes first —
 * a stable move, so everything else keeps the events list’s order.
 */
function playingFirst<T extends SwitchableRow>(rows: T[]): T[] {
  const now = (r: T) => (r.band === "entered" && r.eventStatus === "live" ? 0 : 1);
  return rows.map((r, i) => ({ r, i })).sort((a, b) => {
    if (a.r.band === "entered" && b.r.band === "entered") return now(a.r) - now(b.r) || a.i - b.i;
    return a.i - b.i;
  }).map(({ r }) => r);
}
