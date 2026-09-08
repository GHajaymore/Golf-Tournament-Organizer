/**
 * Finding yourself in a list of names, on the first tee.
 *
 * The round-code screen hands a player the whole field alphabetically and
 * nothing else. On a thirty-three player event that is four screens of
 * scrolling to tap your own name, one-handed, in daylight — and an open day is
 * worse. The organizer's score-entry list got a search box at a comparable
 * length, and it is used by one person sitting down.
 *
 * Pure, because the picker's list only exists after a code has been redeemed,
 * so the rules cannot be reached by rendering the component. The two worth
 * pinning are both here: when a filter earns its place, and that filtering
 * never reorders.
 */

/**
 * The shortest field that gets a filter.
 *
 * Below this a golfer sees their own name without looking for it, and a box
 * would cost a tap and save nothing — a society four-ball does not search four
 * names. Twelve is about where a list stops fitting on a phone and scanning
 * becomes scrolling.
 *
 * A property of the LIST, not of any particular tournament.
 */
export const NAME_FILTER_FROM = 12;

export function showsNameFilter(count: number): boolean {
  return count > NAME_FILTER_FROM;
}

/**
 * The names still on screen for what has been typed.
 *
 * FILTERS, NEVER REORDERS. A player scanning alphabetically for their own name
 * must not have it move while they type — the whole reason they are looking at
 * an ordered list is that the order is stable.
 *
 * Matched anywhere in the name rather than at the start, because plenty of
 * golfers reach for their surname first, and case-insensitively because
 * nobody capitalises on a phone in the rain.
 */
export function filterNames<T extends { name: string }>(names: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...names];
  return names.filter((n) => n.name.toLowerCase().includes(needle));
}
