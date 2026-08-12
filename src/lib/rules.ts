/**
 * Citations to the published Rules, for the places this app enforces one.
 *
 * Why this exists: most of what a tournament app does is not arbitrary. A
 * scorecard has to be certified, ties have to be decided by a method the
 * Committee set in advance, a four-ball has its own order of play. When the app
 * insists on something, saying which rule it comes from turns a constraint that
 * looks like our opinion into one that is not — and it is the difference
 * between software a committee tolerates and software a committee trusts.
 *
 * Three deliberate limits, each of which is the whole point:
 *
 * 1. THE TEXT IS NOT REPRODUCED. The Rules of Golf are © USGA and R&A. We cite
 *    the number and title and link to the publisher. Quoting the text into this
 *    repository would be a copyright problem, and — since the Rules are revised
 *    on a cycle — would also go stale silently, which is worse than absent.
 *
 * 2. THREE DIFFERENT DOCUMENTS, NOT ONE. Conflating them is the tell of an
 *    amateur implementation, because they are separately published, separately
 *    revised, and answer different questions:
 *
 *      Rules of Golf        — how the game is played. Rule 3.3b, Rule 21, 22, 23.
 *      Committee Procedures — how a competition is run: deciding ties, the
 *                             terms of the competition, pace of play.
 *      Rules of Handicapping (WHS) — course handicap, allowances, net double
 *                             bogey. NOT the Rules of Golf, and a citation that
 *                             says otherwise is simply wrong.
 *
 * 3. CURATED, NOT GENERATED. Every entry here is written by hand against a
 *    feature that actually implements it. A citation is an authoritative claim;
 *    a wrong one is worse than none, because it will be believed. `reviewed` is
 *    the date a human last checked the reference still says what we think.
 *
 * Adding a citation to a feature that only loosely relates to a rule is the
 * failure mode to avoid. If it is not the rule the code implements, leave it out.
 */

export type RuleSource = "rules-of-golf" | "committee-procedures" | "handicapping";

export interface RuleRef {
  /** Stable key used by components. */
  key: string;
  /** As the publisher numbers it, e.g. "3.3b". Shown to the user. */
  number: string;
  /** The publisher's heading, not our paraphrase. */
  title: string;
  source: RuleSource;
  /** Where to read it. Publisher's own site — never a mirror. */
  url: string;
  /** One line, in our words, on why this app is citing it here. */
  why: string;
  /** ISO date a human last verified this reference. */
  reviewed: string;
}

export const RULE_SOURCE_LABEL: Record<RuleSource, string> = {
  "rules-of-golf": "Rules of Golf",
  "committee-procedures": "Committee Procedures",
  handicapping: "Rules of Handicapping",
};

/**
 * The citations, keyed by what the app does rather than by rule number — the
 * call site knows the feature, not the paragraph.
 */
export const RULES: Record<string, RuleRef> = {
  scorecardCertification: {
    key: "scorecardCertification",
    number: "3.3b",
    title: "Scoring in Stroke Play",
    source: "rules-of-golf",
    url: "https://www.usga.org/rules/rules-and-decisions.html#!rule-03",
    why:
      "The marker certifies the hole scores and the player certifies their own card before it is returned. It is why approval is two steps here and not one.",
    reviewed: "2026-08-11",
  },
  decidingTies: {
    key: "decidingTies",
    number: "Committee Procedures 5A",
    title: "Deciding Ties",
    source: "committee-procedures",
    url: "https://www.usga.org/rules/rules-and-decisions.html#!ruletype=co",
    why:
      "The method for breaking a tie has to be set before play, not chosen after it. That is why tiebreakers are part of setting a round up rather than a button on the leaderboard.",
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
    why: "Points are awarded against a fixed target score per hole, and a hole not completed simply scores zero.",
    reviewed: "2026-08-11",
  },
  handicapAllowance: {
    key: "handicapAllowance",
    number: "Rules of Handicapping, Appendix C",
    title: "Handicap Allowances",
    source: "handicapping",
    url: "https://www.usga.org/handicapping/roh/2020-rules-of-handicapping.html",
    why:
      "The percentage applied to a course handicap depends on the format — 85% for four-ball, 50% for foursomes, and so on. This is handicapping, not the Rules of Golf.",
    reviewed: "2026-08-11",
  },
  courseHandicap: {
    key: "courseHandicap",
    number: "Rules of Handicapping, Rule 6",
    title: "Course Handicap and Playing Handicap",
    source: "handicapping",
    url: "https://www.usga.org/handicapping/roh/2020-rules-of-handicapping.html",
    why: "Converts a Handicap Index to strokes at the tees actually being played, which is what the card allocates.",
    reviewed: "2026-08-11",
  },
};

export function ruleFor(key: string): RuleRef | null {
  return RULES[key] ?? null;
}
