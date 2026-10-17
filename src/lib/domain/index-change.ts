import { indexFigure } from "@/lib/domain/handicap-label";

/**
 * CHANGING ONE PLAYER'S HANDICAP INDEX, AND WHAT IT MOVES (2026-10-16).
 *
 * Ajay: "organizer need an option to adjust individual handicap of the player
 * and then another option to push it to member screen to become its new
 * handicap." The review panel (docs/handicap-push-brief-2026-10-16.md) agreed
 * on the INDEX, never the round figure: a round's figure is a whole-stroke
 * COURSE handicap for one course, set of tees and par (Rules of Handicapping
 * 6.1), and 12 strokes off a slope of 135 is an index near 10.0, not 12.
 *
 * So an index change moves this tournament's copy of the player's index for
 * every round not yet played, and — when asked, and allowed — the member
 * record every later tournament copies. A round with a card keeps what it was
 * scored off; a round holding its own figure for the player keeps that, since
 * a round's own figure beats the index (`resolveRoundHandicap`).
 *
 * The words live here so the preview and the confirmation cannot disagree
 * with each other or with what the server did.
 */

/** One of the tournament's rounds, as an index change sees it. */
export interface IndexChangeRound {
  label: string;
  /** A card is in, so the round keeps what it was scored off. */
  played: boolean;
  /** The round's own figure for this player (whole strokes), which wins over the index. */
  ownFigure: number | null;
}

export interface IndexChangePlan {
  moves: string[];
  keepsPlayed: string[];
  keepsOwnFigure: { label: string; figure: number }[];
}

export function planIndexChange(rounds: readonly IndexChangeRound[]): IndexChangePlan {
  const plan: IndexChangePlan = { moves: [], keepsPlayed: [], keepsOwnFigure: [] };
  for (const r of rounds) {
    if (r.played) plan.keepsPlayed.push(r.label);
    else if (r.ownFigure !== null) plan.keepsOwnFigure.push({ label: r.label, figure: r.ownFigure });
    else plan.moves.push(r.label);
  }
  return plan;
}

/**
 * Why this figure is not stored as an index, or null. On top of the range
 * (`indexRefusal`): an index has one decimal place, and 14.25 is a typo or a
 * playing figure worked out by hand, not an index anybody holds.
 */
export function indexDecimalRefusal(value: number): string | null {
  return Math.abs(Math.round(value * 10) - value * 10) > 1e-9
    ? "An index has one decimal at most — 14.2, not 14.25."
    : null;
}

/**
 * Whether the member record may take the new figure, and if not, the sentence
 * that says why — in the outfit's own word: a society or a league of mixed
 * golfers keeps its own handicaps and adjusts them as often as a club does,
 * and is not told about "this club" (Ajay, 2026-10-16).
 */
export function memberPushRefusal(facts: {
  /** What the outfit calls itself — "club", "society", "league". */
  noun?: string;
  /** No member record linked to this entry: a guest. */
  guest: boolean;
  name: string;
  /** The club's admin, not an assistant: a member's index is the club's, for every tournament. */
  admin: boolean;
  /** The club's handicap policy leaves this member's index to an association. */
  association: boolean;
  /** The member's index is stored as a nine-hole figure. */
  nineHole: boolean;
}): string | null {
  const noun = facts.noun || "club";
  if (facts.guest) return `${facts.name} has no member record at this ${noun}, so only this tournament changes.`;
  if (facts.association) {
    return `${facts.name}'s index comes from their association. TourneyHQ won't overwrite it there — an adjustment to it is made by your Handicap Committee in the association's system. This tournament can still use the new figure.`;
  }
  if (facts.nineHole) {
    return `${facts.name}'s index on Members is a nine-hole figure, which the Rules of Handicapping no longer use. Change it on Members as an 18-hole index.`;
  }
  if (!facts.admin) return `Only the ${noun}'s organizer can change an index on Members.`;
  return null;
}

function list(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

const strokes = (n: number) => (n < 0 ? `+${-n}` : String(n));

export interface IndexChangeWords {
  name: string;
  from: number;
  to: number;
  plan: IndexChangePlan;
  /** A card is in for some round of this tournament: the rest of the field started on their figures. */
  fieldStarted: boolean;
  alsoMember: boolean;
  /** Other tournaments this player is entered in, and the figure each keeps. */
  otherEntries: { name: string; handicap: number }[];
}

/** What pressing Save will do, said before it is pressed. */
export function indexChangePreview(w: IndexChangeWords): string {
  const to = indexFigure(w.to);
  const parts: string[] = [];
  parts.push(
    w.plan.moves.length > 0
      ? `Changes ${w.name}'s index from ${indexFigure(w.from)} to ${to} for ${list(w.plan.moves)} of this tournament.`
      : `No round of this tournament is left to take ${to}.`,
  );
  if (w.plan.keepsPlayed.length > 0) {
    parts.push(`${list(w.plan.keepsPlayed)} ${w.plan.keepsPlayed.length === 1 ? "keeps its figure — it has" : "keep their figures — they have"} been played.`);
  }
  for (const k of w.plan.keepsOwnFigure) {
    parts.push(`${k.label} keeps the ${strokes(k.figure)} strokes set for it, which wins over the index — clear that to use ${to}.`);
  }
  if (w.fieldStarted && w.plan.moves.length > 0) {
    parts.push("The rest of the field keep the handicaps they started with.");
  }
  if (w.alsoMember) {
    parts.push(`On Members, ${to} becomes ${w.name}'s index for every tournament they enter from now on.`);
    for (const e of w.otherEntries) parts.push(`Their entry in ${e.name} keeps ${indexFigure(e.handicap)}.`);
  }
  return parts.join(" ");
}

/** What was done, said where Save was pressed. */
export function indexChangeDone(w: { name: string; to: number; plan: IndexChangePlan; alsoMember: boolean }): string {
  const to = indexFigure(w.to);
  const where = w.plan.moves.length > 0 ? ` for ${list(w.plan.moves)}` : "";
  const kept = w.plan.keepsPlayed.length > 0 ? ` ${list(w.plan.keepsPlayed)} kept ${w.plan.keepsPlayed.length === 1 ? "its figure" : "their figures"}.` : "";
  return `Done. ${w.name}'s index is ${to}${where}${w.alsoMember ? ", and on Members" : ""}.${kept}`;
}
