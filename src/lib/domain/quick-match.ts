/**
 * A match between two people, planned from the little the two of them know.
 *
 * The rest of this app is built for a tournament — a field, flights, a
 * sequence of rounds, a leaderboard. That is the right shape for the club
 * championship and the wrong shape for the commonest game in golf: two people
 * on the first tee who want to play each other.
 *
 * Walked end to end on 2026-09-07, setting one up meant six screens: pick a
 * "tournament shape" (none of which is a match), pick a "kind of tournament"
 * (none of which is a match), enter your opponent — WITH an email address and
 * a mobile number, both refused if blank — generate "flights" of two, change
 * the round's format from Stroke Play to Match Play, and then supply a full
 * scorecard with par and stroke index, because the stroke play you did not
 * ask for needs one and the match play you did would not have. Every one of
 * those is defensible for a club running a championship. Together they are why
 * somebody gave up and played without the app.
 *
 * So this module is the whole of the decision, in one place: given two names
 * and a couple of choices, what does the app create? It is pure, so the answer
 * is testable without a database, and the server action that writes the rows
 * makes no decisions of its own.
 *
 * What it deliberately does NOT do is relax anything for the tournament path.
 * A championship entrant still needs an address — that is how they sign in and
 * how they are messaged. A friend you are playing on Sunday needs neither,
 * because you are standing next to them and you are the one entering the card.
 */

/** The most a WHS Handicap Index can be, and the best a plus-handicap gets
 *  anywhere near. Stated as a range because a typo of 180 for 18.0 must not
 *  become a player receiving a stroke and a half a hole. */
export const HANDICAP_MIN = -10;
export const HANDICAP_MAX = 54;

export interface MatchPlayerInput {
  name: string;
  /** As typed. A blank, a stray "+2" or nonsense all mean "not stated". */
  handicap?: string | number | null;
  /** Optional, and optional on purpose — see the note at the top of the file. */
  email?: string | null;
}

export interface MatchSetupInput {
  players: MatchPlayerInput[];
  /** 18 or 9. Anything else is a caller mistake and becomes 18. */
  holes?: number | string | null;
  /** Which nine, when nine is played. */
  nine?: string | null;
  /** Whether strokes are given. Off means the match is played level. */
  useHandicaps?: boolean;
  courseId?: string | null;
  /** What to call it. Blank names the match after the two players. */
  name?: string | null;
}

export interface PlannedMatchPlayer {
  name: string;
  handicap: number;
  email: string;
  seed: number;
}

export interface MatchPlan {
  name: string;
  players: PlannedMatchPlayer[];
  holes: 9 | 18;
  nine: "full" | "front" | "back";
  /** Match Play, always. The format IS the ask; offering a choice here would
   *  reintroduce the step that sent an organizer away with stroke play. */
  format: "Match Play";
  scoringBasis: "gross" | "net";
  courseId: string | null;
}

export type MatchPlanResult = { ok: true; plan: MatchPlan } | { ok: false; error: string };

/**
 * A handicap as a number, or 0 for anything that isn't one.
 *
 * Zero rather than a refusal: "I don't know my handicap" is the normal state
 * of half the people who play a Sunday match, and stopping the whole setup to
 * demand one would be the same species of obstacle this module exists to
 * remove. A match played off zeros is a match played level, which is what
 * happens on the tee anyway.
 *
 * Plus-handicaps arrive as "+2" from a player writing what is on their card,
 * and a plus-handicap is BETTER than scratch — it is negative in every
 * calculation. Reading "+2" as 2 would hand two shots to the best player in
 * the match.
 */
export function parseHandicap(raw: string | number | null | undefined): number {
  if (typeof raw === "number") return clampHandicap(raw);
  const text = (raw ?? "").trim();
  if (!text) return 0;
  const plus = /^\+/.test(text);
  const n = Number(text.replace(/^\+/, ""));
  if (!Number.isFinite(n)) return 0;
  return clampHandicap(plus ? -Math.abs(n) : n);
}

function clampHandicap(n: number): number {
  if (!Number.isFinite(n)) return 0;
  // One decimal, which is the precision a Handicap Index is published to.
  const rounded = Math.round(n * 10) / 10;
  return Math.min(HANDICAP_MAX, Math.max(HANDICAP_MIN, rounded));
}

/** 18 unless nine was actually asked for. */
function planHoles(raw: number | string | null | undefined): 9 | 18 {
  return Number(raw) === 9 ? 9 : 18;
}

/**
 * Which nine, forced to "full" over eighteen holes.
 *
 * Enforced here rather than trusted from the form, because "the back nine" on
 * an eighteen-hole round is not a preference the app can honour — it is a
 * contradiction, and one that survives into the scorecard as holes scored
 * against the wrong stroke indexes. The setting only means anything when nine
 * holes are played.
 */
function planNine(raw: string | null | undefined, holes: 9 | 18): "full" | "front" | "back" {
  if (holes !== 9) return "full";
  return raw === "front" || raw === "back" ? raw : "full";
}

/** "Alex v Sam" — what the two of them would call it. */
export function matchTitle(a: string, b: string): string {
  return `${a} v ${b}`;
}

export function planMatch(input: MatchSetupInput): MatchPlanResult {
  const named = (input.players ?? [])
    .map((p) => ({
      name: (p.name ?? "").trim(),
      handicap: parseHandicap(p.handicap),
      email: (p.email ?? "").trim().toLowerCase(),
    }))
    .filter((p) => p.name.length > 0);

  if (named.length < 2) {
    return { ok: false, error: "A match needs two players — add both names." };
  }
  if (named.length > 2) {
    return { ok: false, error: "A match is between two players. For a bigger game, create a tournament." };
  }
  /**
   * Two sides, told apart by name.
   *
   * Not fussiness: a match is stored as playerA against playerB and read back
   * as a name on each side of a scorecard, so two identically named entries
   * produce a card on which neither the organizer nor the engine can say whose
   * hole was whose. Compared case-insensitively because "sam" and "Sam" are
   * the same person typing quickly, not two people.
   */
  if (named[0].name.toLowerCase() === named[1].name.toLowerCase()) {
    return { ok: false, error: "Both players have the same name — give them something to tell them apart." };
  }

  const holes = planHoles(input.holes);
  const title = (input.name ?? "").trim() || matchTitle(named[0].name, named[1].name);

  return {
    ok: true,
    plan: {
      name: title,
      players: named.map((p, i) => ({ ...p, seed: i + 1 })),
      holes,
      nine: planNine(input.nine, holes),
      format: "Match Play",
      // Gross when nobody asked for strokes. A level match is the default
      // because it is the one that needs no handicap to be correct — a net
      // match with two zeros is a level match that claims to be something
      // else.
      scoringBasis: input.useHandicaps ? "net" : "gross",
      courseId: (input.courseId ?? "").trim() || null,
    },
  };
}

/**
 * Does this match need the course's card before it can be scored?
 *
 * Only a net match does. Strokes are given by stroke index, so a net match
 * without a card cannot allocate them and would quietly score as gross. A
 * level match needs nothing: who won the hole is not a question par can help
 * with, which is exactly why the setup screen asks for a course last and never
 * insists on it.
 */
export function matchNeedsCard(plan: Pick<MatchPlan, "scoringBasis">): boolean {
  return plan.scoringBasis === "net";
}
