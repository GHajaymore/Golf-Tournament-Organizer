import { findFormat, lookupFormat, sideSizeRange, type ScoringEngine } from "./formats";

/**
 * Whether a sequence of rounds actually fits together.
 *
 * A multi-round tournament chains: standings carry forward, and cuts pick who
 * plays the next round from the last one's results. Both assume the rounds are
 * measuring the same thing — and once rounds can be set to any format, they
 * frequently aren't.
 *
 * Carrying 8 match points into a stroke-play round doesn't produce a wrong
 * number so much as a meaningless one, and nothing downstream can detect that.
 * A cut from a scramble into a singles round has to answer a question nobody
 * asked: the scramble ranked four-person sides, so which *players* advance?
 *
 * None of this is invalid enough to refuse — plenty of real tournaments do
 * deliberately odd things, and an organizer who understands the trade should
 * not be blocked by an app that doesn't. So these are warnings with the reason
 * stated, not errors.
 */

/** What a round's standings actually measure. */
export type StandingsUnit = "match points" | "strokes" | "Stableford points" | "modified Stableford points" | "skins";

export interface ChainRound {
  /** 0-based order in the tournament. */
  position: number;
  format: string;
  scoringBasis: string;
  carryForwardEnabled: boolean;
  cutEnabled: boolean;
}

export type IssueKind =
  | "carry-unit-mismatch"
  | "cut-team-to-individual"
  | "cut-individual-to-team"
  | "team-size-change"
  | "carry-from-nassau"
  | "carry-from-skins";

export interface ChainIssue {
  kind: IssueKind;
  /** The round the problem is *reported on* — the later of the pair. */
  round: number;
  message: string;
}

/**
 * What this round's standings are denominated in.
 *
 * Stroke play scored as Stableford measures points, not strokes — the basis
 * changes the unit, which is exactly why this can't be read off the format
 * name alone.
 */
export function standingsUnit(format: string, scoringBasis: string): StandingsUnit {
  const engine: ScoringEngine = findFormat(format).engine;
  switch (engine) {
    case "skins":
      return "skins";
    case "modified-stableford":
      return "modified Stableford points";
    case "stableford":
      return "Stableford points";
    case "match":
    case "nassau":
    case "team-aggregate":
    case "team-single":
      // Team rounds resolve to match results when they're played as matches,
      // and to a stroke total otherwise — the basis decides.
      if (engine === "team-aggregate" || engine === "team-single") {
        return scoringBasis === "stableford" ? "Stableford points" : "strokes";
      }
      return "match points";
    case "stroke":
    default:
      return scoringBasis === "stableford" ? "Stableford points" : "strokes";
  }
}

const label = (r: ChainRound) => `Round ${r.position + 1}`;

/**
 * Problems in an ordered list of rounds.
 *
 * Only reports where the tournament actually chains — a round with no carry
 * forward and no cut is independent, and two unrelated formats sitting side by
 * side is a perfectly ordinary multi-format event, not a mistake.
 */
export function chainIssues(rounds: ChainRound[]): ChainIssue[] {
  const issues: ChainIssue[] = [];
  const ordered = [...rounds].sort((a, b) => a.position - b.position);

  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    // Unknown formats can't be reasoned about; say nothing rather than guess.
    if (!lookupFormat(prev.format) || !lookupFormat(cur.format)) continue;

    const prevFmt = findFormat(prev.format);
    const curFmt = findFormat(cur.format);
    const prevTeam = prevFmt.sideSize > 1;
    const curTeam = curFmt.sideSize > 1;

    if (cur.carryForwardEnabled) {
      const from = standingsUnit(prev.format, prev.scoringBasis);
      const to = standingsUnit(cur.format, cur.scoringBasis);
      if (from !== to) {
        issues.push({
          kind: "carry-unit-mismatch",
          round: cur.position,
          message: `${label(cur)} carries forward from ${label(prev)}, but ${label(prev)} is scored in ${from} and ${label(cur)} in ${to}. Carrying one into the other produces a number that doesn't mean anything.`,
        });
      } else if (prevFmt.engine === "nassau") {
        issues.push({
          kind: "carry-from-nassau",
          round: cur.position,
          message: `${label(prev)} is a Nassau, which settles three bets per match. Only the overall result carries into ${label(cur)} — the front and back nine are not counted separately.`,
        });
      } else if (prevFmt.engine === "skins") {
        issues.push({
          kind: "carry-from-skins",
          round: cur.position,
          message: `${label(prev)} is skins, where a player can win the day on one hole and score nothing on the rest. Carrying skins into ${label(cur)} rewards that far more than a round's play.`,
        });
      }
    }

    if (cur.cutEnabled) {
      if (prevTeam && !curTeam) {
        issues.push({
          kind: "cut-team-to-individual",
          round: cur.position,
          message: `${label(cur)} cuts the field from ${label(prev)}, but ${label(prev)} is ${prevFmt.name} — it ranks sides, not players. Decide who advances from each side before this round starts.`,
        });
      } else if (!prevTeam && curTeam) {
        issues.push({
          kind: "cut-individual-to-team",
          round: cur.position,
          message: `${label(cur)} is ${curFmt.name} and cuts from ${label(prev)}, which ranks individuals. The players who survive the cut will need new sides drawn.`,
        });
      }
    }

    if (prevTeam && curTeam) {
      const a = sideSizeRange(prev.format);
      const b = sideSizeRange(cur.format);
      if (a.min !== b.min || a.max !== b.max) {
        issues.push({
          kind: "team-size-change",
          round: cur.position,
          message: `${label(prev)} plays ${a.min === a.max ? a.min : `${a.min}–${a.max}`} to a side and ${label(cur)} plays ${b.min === b.max ? b.min : `${b.min}–${b.max}`}. The sides have to be redrawn between them.`,
        });
      }
    }
  }

  return issues;
}

/** Issues that concern one round, for showing on that round's card. */
export function issuesForRound(issues: ChainIssue[], position: number): ChainIssue[] {
  return issues.filter((i) => i.round === position);
}
