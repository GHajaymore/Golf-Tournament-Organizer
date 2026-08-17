import { tiebreakerLabel, type TiebreakerKey } from "@/lib/domain/types";

/**
 * The rules a competition actually runs under, in the three tiers a golfer
 * meets them.
 *
 * This mirrors the real hierarchy, which is not one document but three, applied
 * in order of increasing specificity:
 *
 *   1. THE RULES OF GOLF — how the game is played. Published by the USGA and
 *      The R&A jointly. (Not the PGA: that is an association of professionals,
 *      and a "PGA hard card" is a tier-2 document, not a rules book. Getting
 *      this wrong in front of a committee is the fastest way to lose them.)
 *      The Rules of Handicapping sit here too — separately published again, and
 *      the source of course handicap and format allowances.
 *
 *   2. THE TERMS OF THE COMPETITION — what this tournament has decided within
 *      those rules: format, allowance, how ties break, where the cut falls.
 *      DERIVED, not typed. The app already holds every one of these as
 *      configuration, so it can state them rather than ask an organizer to
 *      write them out and keep them in step. This is the tier nobody else
 *      generates, and it is the one a committee is obliged to publish.
 *
 *   3. LOCAL RULES — the club's own, for its course. Optional, free text,
 *      because they are about ground under repair and internal out of bounds
 *      and no schema will ever anticipate them.
 *
 * Tier 1 is cited and linked, never reproduced: the Rules are © USGA and R&A,
 * and copying them in would also go stale silently as they are revised.
 */

export type RuleTier = "rules-of-golf" | "tournament" | "local";

export type RuleSource = "rules-of-golf" | "committee-procedures" | "handicapping";

export interface RuleRef {
  key: string;
  /** As the publisher numbers it, e.g. "3.3b". */
  number: string;
  /** The publisher's heading, not our paraphrase. */
  title: string;
  source: RuleSource;
  url: string;
  /** One line, in our words, on why this app cites it. */
  why: string;
  /** ISO date a human last verified the reference. */
  reviewed: string;
}

export const RULE_SOURCE_LABEL: Record<RuleSource, string> = {
  "rules-of-golf": "Rules of Golf",
  "committee-procedures": "Committee Procedures",
  handicapping: "Rules of Handicapping",
};

export const TIER_LABEL: Record<RuleTier, string> = {
  "rules-of-golf": "Rules of Golf",
  tournament: "Tournament rules",
  local: "Course rules",
};

/** Tier 1 — cited, curated by hand, never generated. */
export const RULES: Record<string, RuleRef> = {
  scorecardCertification: {
    key: "scorecardCertification",
    number: "3.3b",
    title: "Scoring in Stroke Play",
    source: "rules-of-golf",
    url: "https://www.usga.org/rules/rules-and-decisions.html#!rule-03",
    why:
      "The marker certifies the hole scores and the player certifies their own card before it is returned. It is why approval here is two steps and not one.",
    reviewed: "2026-08-11",
  },
  decidingTies: {
    key: "decidingTies",
    number: "5A",
    title: "Deciding Ties",
    source: "committee-procedures",
    url: "https://www.usga.org/rules/rules-and-decisions.html#!ruletype=co",
    why:
      "The method for breaking a tie has to be set before play, not chosen once there is a tie to break.",
    reviewed: "2026-08-11",
  },
  fourBall: {
    key: "fourBall",
    number: "23",
    title: "Four-Ball",
    source: "rules-of-golf",
    url: "https://www.usga.org/rules/rules-and-decisions.html#!rule-23",
    why: "Each partner plays their own ball and the side's score is the better of the two.",
    reviewed: "2026-08-11",
  },
  foursomes: {
    key: "foursomes",
    number: "22",
    title: "Foursomes (Alternate Shot)",
    source: "rules-of-golf",
    url: "https://www.usga.org/rules/rules-and-decisions.html#!rule-22",
    why: "Partners alternate strokes, and which of them tees off is fixed by hole, not by choice.",
    reviewed: "2026-08-11",
  },
  stableford: {
    key: "stableford",
    number: "21.1",
    title: "Stableford",
    source: "rules-of-golf",
    url: "https://www.usga.org/rules/rules-and-decisions.html#!rule-21",
    why: "Points are awarded against a fixed target per hole, and a hole not completed scores zero.",
    reviewed: "2026-08-11",
  },
  matchPlay: {
    key: "matchPlay",
    number: "3.2",
    title: "Match Play",
    source: "rules-of-golf",
    url: "https://www.usga.org/rules/rules-and-decisions.html#!rule-03",
    why: "A match is won by holes, and is over once a side leads by more holes than remain.",
    reviewed: "2026-08-11",
  },
  handicapAllowance: {
    key: "handicapAllowance",
    number: "Appendix C",
    title: "Handicap Allowances",
    source: "handicapping",
    url: "https://www.usga.org/handicapping/roh/2020-rules-of-handicapping.html",
    why:
      "The percentage applied to a course handicap depends on the format — 85% for four-ball, 50% for foursomes. Handicapping, not the Rules of Golf.",
    reviewed: "2026-08-11",
  },
  courseHandicap: {
    key: "courseHandicap",
    number: "Rule 6",
    title: "Course Handicap and Playing Handicap",
    source: "handicapping",
    url: "https://www.usga.org/handicapping/roh/2020-rules-of-handicapping.html",
    why: "Converts a Handicap Index to strokes at the tees actually played, which is what the card allocates.",
    reviewed: "2026-08-11",
  },
};

export function ruleFor(key: string): RuleRef | null {
  return RULES[key] ?? null;
}

/* ── Tier 2: the terms of this competition, derived ────────────────────────
   Read off the configuration rather than typed by an organizer, so the
   published terms and the way the app actually scores cannot disagree. That
   divergence is the entire failure mode of a hand-written hard card. */

export interface TermItem {
  label: string;
  value: string;
  /** The tier-1 rule this term is exercising a choice under, if there is one. */
  rule?: string;
}

export interface TermsInput {
  format: string;
  type: string;
  holes: number;
  scoringBasis: string;
  handicapAllowance: number;
  countBest: number;
  tiebreakers: TiebreakerKey[];
  cutEnabled: boolean;
  cutMode: string;
  cutCount: number;
  cutPercent: number;
  carryForwardEnabled: boolean;
  carryForwardPct: number;
}

/** Which tier-1 rule a format is played under, where one names it directly. */
function ruleForFormat(format: string): string | undefined {
  const f = format.toLowerCase();
  if (f.includes("four-ball") || f.includes("fourball")) return "fourBall";
  if (f.includes("foursome") || f.includes("greensome")) return "foursomes";
  if (f.includes("match")) return "matchPlay";
  return undefined;
}

/**
 * The competition's own terms, in the order a committee would post them.
 *
 * Only states what has actually been decided: a term left at its default is
 * omitted rather than asserted, because publishing "handicap allowance 0%"
 * when nobody set one reads as a decision and is not.
 */
export function tournamentTerms(input: TermsInput): TermItem[] {
  const out: TermItem[] = [];

  out.push({
    label: "Format",
    value: `${input.format}${input.type && input.type !== input.format ? ` · ${input.type}` : ""}`,
    rule: ruleForFormat(input.format),
  });

  out.push({ label: "Holes", value: String(input.holes) });

  if (input.scoringBasis) {
    out.push({
      label: "Scoring",
      value:
        input.scoringBasis === "stableford"
          ? "Stableford"
          : input.scoringBasis === "net"
            ? "Net"
            : input.scoringBasis === "both"
              ? "Gross and net"
              : "Gross",
      rule: input.scoringBasis === "stableford" ? "stableford" : undefined,
    });
  }

  if (input.handicapAllowance > 0) {
    out.push({
      label: "Handicap allowance",
      value: `${input.handicapAllowance}% of course handicap`,
      rule: "handicapAllowance",
    });
  }

  if (input.countBest > 0) {
    out.push({
      label: "Balls counting",
      value: `Best ${input.countBest} of the side's scores on each hole`,
    });
  }

  if (input.tiebreakers.length) {
    out.push({
      label: "Ties",
      value: input.tiebreakers.map((t) => tiebreakerLabel(t)).join(", then "),
      rule: "decidingTies",
    });
  }

  if (input.cutEnabled) {
    out.push({
      label: "Cut",
      value:
        input.cutMode === "percent"
          ? `Top ${input.cutPercent}% advance to the next round`
          : `Top ${input.cutCount} advance to the next round`,
    });
  }

  if (input.carryForwardEnabled && input.carryForwardPct > 0) {
    out.push({
      label: "Carry forward",
      value: `${input.carryForwardPct}% of this round's points carry into the next`,
    });
  }

  out.push({
    label: "Scorecards",
    value: "Certified by the marker and the player, then approved by the committee",
    rule: "scorecardCertification",
  });

  return out;
}
