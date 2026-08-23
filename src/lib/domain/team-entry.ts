import { findFormat, needsTeams } from "../formats";

/**
 * Whose card a team round is written on — the side's, or each player's.
 *
 * The rule, decided 2026-08-21 and stated in
 * `docs/requirement-team-score-entry.md`:
 *
 * > **The input mirrors the physical scorecard. The override may reduce
 * > detail; it may never invent it.**
 *
 * That single sentence answers "team or individual?" for every format without
 * anybody keeping a list, because it reads the thing that is already true:
 *
 *   one ball  → one line on the paper card → the SIDE's card, and nothing else.
 *   two balls → two lines → each PLAYER's card, and the side's score derived.
 *
 * Nothing here is a new setting on a format. `formats.ts` already declares
 * `ball`, because the number of balls is a fact about the game rather than a
 * preference — so this asks that, and a format added tomorrow is answered the
 * day it is added.
 */

/** Where a team round's strokes are written down. */
export type TeamEntryMode = "per-player" | "side-only";

export const TEAM_ENTRY_MODES: Array<{ key: TeamEntryMode; label: string; blurb: string }> = [
  {
    key: "per-player",
    label: "Each player's own card",
    blurb:
      "Every player's strokes on every hole, as they wrote them. The side's score is worked out from them.",
  },
  {
    key: "side-only",
    label: "One card for the side",
    blurb: "One line of strokes for the whole side, the way a shared ball is written down.",
  },
];

/**
 * How this round may be written down, natural shape first.
 *
 * An empty list means the question does not arise — an individual format has
 * no side to ask about.
 *
 * A one-ball format offers `side-only` ALONE. That is not a restriction; it is
 * the absence of a choice. In foursomes the side plays one ball, alternating
 * strokes under Rule 22, so there is no such thing as a player's gross for the
 * hole — offering "each player's own card" would invite somebody to invent a
 * round nobody played, which `match-cards.ts` already refuses to do for the
 * same reason. Golf Genius ships a help article titled "How can I enter one
 * team scores for each hole rather than individual?", and the existence of
 * that article is the argument: their organizers set up alternate shot, get
 * individual entry, and go looking for support.
 */
export function teamEntryChoices(formatName: string): TeamEntryMode[] {
  if (!needsTeams(formatName)) return [];
  // One ball, one card. The other option is not withheld — it does not exist.
  if (findFormat(formatName).ball === "single") return ["side-only"];
  // Two balls: both scores are real and both are on the paper card. Recording
  // only the side's is allowed because it LOSES detail rather than inventing
  // it, which is the direction the rule permits.
  return ["per-player", "side-only"];
}

/** The shape a round takes without anybody choosing. */
export function declaredTeamEntry(formatName: string): TeamEntryMode | null {
  return teamEntryChoices(formatName)[0] ?? null;
}

/**
 * What this round is actually recorded in.
 *
 * An override the format does not offer falls back to its natural shape rather
 * than being honoured. A stored `"per-player"` on a foursomes round — set
 * before the format was changed, or posted straight at the endpoint — must not
 * open an entry screen asking for two scores where one ball was played.
 */
export function resolveTeamEntry(formatName: string, override?: string | null): TeamEntryMode | null {
  const choices = teamEntryChoices(formatName);
  if (choices.length === 0) return null;
  const wanted = (override ?? "").trim() as TeamEntryMode;
  return choices.includes(wanted) ? wanted : choices[0];
}

/**
 * What choosing `side-only` costs, where it is a choice at all.
 *
 * Under WHS a four-ball score is acceptable for handicapping when the player's
 * own ball is recorded. Taking the side's score alone gives that up — for
 * every player in the field, not just the one making the choice — and it is
 * given up quietly, because nothing about the entry screen afterwards looks
 * any different.
 *
 * Returns null for a one-ball format: a foursomes round is not an individual
 * round and never was a counting score, so there is nothing to warn about and
 * a warning would only imply something had been lost.
 *
 * This belongs BESIDE the control, not in a footnote and not in a `title` —
 * see `no-tooltip-refusals.test.ts`.
 */
export function sideOnlyCost(formatName: string): string | null {
  if (!teamEntryChoices(formatName).includes("per-player")) return null;
  return (
    "Recording only the side's score means this round cannot count towards anybody's handicap. " +
    "A four-ball counts for handicapping when a player's own ball is written down, and this gives " +
    "that up for the whole field. It also changes the net score: with no individual balls to " +
    "compare, the side's net comes from the side's playing handicap rather than from the better " +
    "net ball, so it will not always match the same round entered card by card."
  );
}


/**
 * What the entry screen says this round is written down as.
 *
 * Here rather than in the component because it answers a question the screen
 * currently leaves open, and two clubs answering it differently is a silent
 * data problem: WHICH NUMBER goes in the box. For a side-only four-ball that
 * is the better ball's GROSS — the individual balls are gone, so there is no
 * better net ball to take. Nobody would guess that from "one card for the
 * side", and the scorer typing net scores into it would produce a round that
 * validates perfectly and is wrong by the side's handicap.
 *
 * Empty string for a format with no sides, where the question does not arise.
 */
export function teamEntryNote(formatName: string, override?: string | null): string {
  const mode = resolveTeamEntry(formatName, override);
  if (!mode) return "";
  if (mode === "per-player") {
    return "One card each. The side's score is taken from the better ball on every hole.";
  }
  // One ball really is one score. Nothing has been given up and saying so
  // would imply otherwise.
  if (findFormat(formatName).ball === "single") {
    return "One card per side — the partners play a single ball, so there is one score to write down.";
  }
  return (
    "One card for the side. Write the better ball's gross score on each hole — the individual " +
    "balls are not recorded, so the side's net comes from the side's playing handicap rather " +
    "than from the better net ball."
  );
}