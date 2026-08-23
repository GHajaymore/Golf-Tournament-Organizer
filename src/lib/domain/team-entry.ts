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
export function teamEntryChoices(formatName: string, scoringBasis = "gross"): TeamEntryMode[] {
  if (!needsTeams(formatName)) return [];
  // One ball, one card. The other option is not withheld — it does not exist.
  if (findFormat(formatName).ball === "single") return ["side-only"];
  /**
   * Two balls: whether the side's score alone is enough depends on how the
   * round is WON, and that is the half this rule was missing.
   *
   * Gross — the side's score for a hole IS the better ball's gross, so
   * writing that one number down loses nothing that decides the
   * competition. Recording only the side's score is exactly right.
   *
   * Net, both or Stableford — Rule 23.2b makes the side's score the lower
   * NET ball, and that cannot be recovered from a side total. Each partner
   * receives their own strokes off their own handicap, so which ball is
   * better can differ hole by hole from which gross is lower. Deriving a
   * net from a side handicap instead produces a number belonging to no
   * recognised competition, and it would sit on the leaderboard looking
   * exactly like a four-ball result.
   *
   * So the option is not offered rather than warned about — CLAUDE.md:
   * prefer making the wrong thing unrepresentable over documenting that
   * callers must check.
   */
  return scoringBasis.trim().toLowerCase() === "gross"
    ? ["per-player", "side-only"]
    : ["per-player"];
}

/** The shape a round takes without anybody choosing. */
export function declaredTeamEntry(formatName: string, scoringBasis = "gross"): TeamEntryMode | null {
  return teamEntryChoices(formatName, scoringBasis)[0] ?? null;
}

/**
 * What this round is actually recorded in.
 *
 * An override the format does not offer falls back to its natural shape rather
 * than being honoured. A stored `"per-player"` on a foursomes round — set
 * before the format was changed, or posted straight at the endpoint — must not
 * open an entry screen asking for two scores where one ball was played.
 */
export function resolveTeamEntry(
  formatName: string,
  override?: string | null,
  scoringBasis = "gross",
): TeamEntryMode | null {
  const choices = teamEntryChoices(formatName, scoringBasis);
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
export function sideOnlyCost(formatName: string, scoringBasis = "gross"): string | null {
  // Fewer than two choices means there is nothing to warn about: either the
  // side plays one ball, or the round is scored on net and side-only is not
  // offered at all.
  if (teamEntryChoices(formatName, scoringBasis).length < 2) return null;
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
export function teamEntryNote(
  formatName: string,
  override?: string | null,
  scoringBasis = "gross",
): string {
  const mode = resolveTeamEntry(formatName, override, scoringBasis);
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

/**
 * Why this round offers no choice of input, where it offers none.
 *
 * The Rounds screen used to state the one-ball reason for every
 * single-choice round, which was true while one ball was the only way to
 * have no choice. A net four-ball now also has none, and telling a club
 * "one ball, one card" about their four-ball would be simply false.
 *
 * Empty string where there IS a choice, or no sides at all.
 */
export function teamEntryFixedReason(formatName: string, scoringBasis = "gross"): string {
  const choices = teamEntryChoices(formatName, scoringBasis);
  if (choices.length !== 1) return "";
  if (findFormat(formatName).ball === "single") {
    return (
      "One ball, one card — the side's strokes are entered on a single line, the way " +
      `${findFormat(formatName).name} is written down on paper.`
    );
  }
  return (
    "Each player's own card, because this round is scored on net. The side's score is the " +
    "better NET ball, which needs both players' strokes — a single team score cannot produce " +
    "it. Scoring the round on gross would allow one card for the side."
  );
}