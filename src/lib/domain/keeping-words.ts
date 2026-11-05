/**
 * WHO KEEPS THE GROUP'S CARD, SAID ON THE PHONES (2026-11-05, sprint 2 part B,
 * phase 2).
 *
 * At a real cup (2026-10-18) a scorer who tapped an opponent's name recorded
 * holes for the wrong side, and every phone in a four-ball could write the
 * match. On a round kept by ONE SCORER PER GROUP one phone enters the group's
 * scores; every other phone in the group is told whose phone it is, follows
 * the card read-only, and can take it over in one confirmed press. Nobody is
 * shut out: a phone that is not keeping the card still sees it, and still has
 * a way to keep it.
 *
 * The words live here, once, so the round-code screen, its tests and the help
 * pages say the same thing. Pure.
 */

/** What this phone is, for a group whose card one phone keeps. */
export type KeepingRole =
  /** This phone keeps the card: it enters the group's scores. */
  | "keeper"
  /** Another phone keeps it: this one follows, read-only, and may take over. */
  | "follower"
  /** Nobody keeps it yet: this phone may start keeping it. */
  | "open";

/**
 * Which of the three this phone is. `refusedBy` is set when a save from this
 * phone was just refused because the card is kept elsewhere — the server's
 * answer outranks what the page was drawn with, because the card moved since.
 */
export function keepingRole(input: { me: string; keeperId: string | null; refusedBy: string | null }): KeepingRole {
  if (input.refusedBy !== null) return "follower";
  if (input.keeperId === null) return "open";
  return input.keeperId === input.me ? "keeper" : "follower";
}

/** First name only — the name a group calls each other on the tee. */
function first(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim();
}

/** "You're keeping score for Group 3." */
export function youKeepSentence(title: string): string {
  return `You're keeping score for ${groupWords(title)}.`;
}

/** "Group 3 is being kept on Ann's phone." */
export function keptOnSentence(title: string, keeperName: string): string {
  const who = keeperName.trim() ? `${first(keeperName)}'s phone` : "another phone";
  return `${title} is being kept on ${who}.`;
}

/** Said under it: what this phone does now. */
export const FOLLOWING_DETAIL = "You can follow the card here as the scores go in.";

/** Nobody keeps it yet. */
export function nobodyKeepsSentence(title: string): string {
  return `Nobody is keeping ${groupWords(title)}'s card yet.`;
}

/** The one confirmation before a take-over. */
export function takeOverQuestion(keeperName: string): string {
  const who = first(keeperName) || "the other phone";
  return `Take the card over from ${who}? ${who === "the other phone" ? "That phone" : `${who}'s phone`} stops saving scores, and the change is logged.`;
}

/** The one confirmation before a hand-over. */
export function handOverQuestion(toName: string): string {
  return `Hand the card to ${first(toName)}? Their phone keeps score from now on, and this one stops.`;
}

/** After a refused save: what happened to this phone's unsent scores, in words. */
export function refusedSentence(keeperName: string): string {
  const who = keeperName.trim() ? `${first(keeperName)}'s phone` : "another phone";
  return `The card is now kept on ${who}, so this phone's last scores weren't saved. Follow the card below, or take it over.`;
}

/** "Group 3" stays a name; "Your group" reads as "your group" mid-sentence. */
function groupWords(title: string): string {
  return /^Your /.test(title) ? title.replace(/^Your /, "your ") : title;
}

/**
 * THE ORGANIZER'S WARNING (2026-11-05): a round kept by one scorer per group
 * takes its groups from the published tee sheet (`groupKeyFor`), and before it
 * is published each player keeps their own card. A match is its own group
 * until then.
 */
export function noSheetWarning(matchPlay: boolean): string {
  return matchPlay
    ? "Groups come from the tee sheet. Until it is published, each match is kept on one phone of its own."
    : "Groups come from the tee sheet. Until it is published, each player keeps their own card.";
}

/** The casual round's one line (2026-11-05): who enters scores. One phone is the default. */
export const CASUAL_KEEPING: Array<{ key: "group" | "each"; label: string }> = [
  { key: "group", label: "One phone for the group" },
  { key: "each", label: "Each player their own" },
];
