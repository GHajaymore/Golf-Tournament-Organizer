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
  canView: boolean;
}

export interface SwitcherEntry {
  eventId: string;
  name: string;
  /** "You’re in · On now", "Watching · Results" — one line under the name. */
  note: string;
}

export interface Switcher {
  /** The tournament on screen, or null when the list does not hold it. */
  current: (SwitcherEntry & { watching: boolean }) | null;
  /** Everywhere else worth going, in the events list's own order. */
  others: SwitcherEntry[];
}

/**
 * WATCHING is a member looking at a tournament they are not in. It is never
 * said of staff: an organizer checking the player view is running the thing,
 * not spectating it, and "read-only" would be false for them anyway.
 */
export function isWatching(row: Pick<SwitchableRow, "entered"> | null, isStaff: boolean): boolean {
  return !!row && !row.entered && !isStaff;
}

function noteOf(row: SwitchableRow, isStaff: boolean): string {
  // The "entered" band's label IS "You’re in", so it is not said twice. A
  // finished band says "Finished" whether they played or not, so who they
  // were in it comes first.
  const who = row.entered ? "You’re in" : isStaff ? "" : "Watching";
  const what = row.band === "entered" ? "" : row.bandLabel;
  return [who, what].filter(Boolean).join(" · ");
}

export function switcherFor(rows: readonly SwitchableRow[], activeId: string | null, isStaff: boolean): Switcher {
  const active = rows.find((r) => r.eventId === activeId) ?? null;
  /**
   * A row is somewhere to go if the member is in it, or if there is something
   * on it to look at. A draft with no cards is left out for the same reason
   * the events list offers it no board: an empty table reads as a broken link.
   */
  const others = byBand(rows.filter((r) => r.eventId !== activeId && (r.entered || r.canView))).map((r) => ({
    eventId: r.eventId,
    name: r.name,
    note: noteOf(r, isStaff),
  }));
  return {
    current: active
      ? { eventId: active.eventId, name: active.name, note: noteOf(active, isStaff), watching: isWatching(active, isStaff) }
      : null,
    others,
  };
}
