/**
 * THE REPORT'S OWN SHARE CARD AND NEWS LINE (2026-10-23).
 *
 * The report used to unfurl as the BOARD's picture. A report is a different
 * document — it is sent after the event, to say who won — so it has its own:
 * the club's name large, the event, CHAMPION (or "Leads" while it is being
 * played: never "Champion" early), the winning figure, one highlight, and the
 * TourneyHQ mark small at the foot. Its description is a news line: "Jane Doe
 * wins the Spring Medal by 3 at Braid Hollow".
 *
 * THE SAME PRIVACY RULE AS THE BOARD'S CARD (`resultsCard`): a preview is
 * fetched and cached by servers the club never chose, so a tournament whose
 * board is not public gets a card that names nobody and no tournament. And it
 * NEVER carries an amount, on any setting: nothing here is handed one.
 *
 * Pure: the caller hands over the report's own fields.
 */

export interface ReportCardInput {
  event: string;
  club: string;
  venue: string;
  completed: boolean;
  /** Who is first — the champion, the leader, a side, a cup's winning team. */
  names: string[];
  /** The figure they are first on: "gross 141", "38 points", "won the final 2&1". */
  figure: string;
  /** "by 3", "by 2 points", "on countback", or "" where a margin is not a number. */
  margin: string;
  /** One line of the highlights: "Eagle · Bob Example". "" for none. */
  highlight: string;
  /** A cup: the score, "14½–9½", and the verdict's words, "CDG win the cup". */
  cup?: { score: string; verdict: string } | null;
}

export type ReportCard =
  | { kind: "private"; headline: string; subtitle: string }
  | {
      kind: "report";
      club: string;
      event: string;
      /** "Champion", "Joint winners", "Leads", "Lead", "Cup". */
      label: string;
      names: string;
      figure: string;
      highlight: string;
    };

const PRIVATE: ReportCard = {
  kind: "private",
  headline: "TourneyHQ",
  subtitle: "Live golf leaderboards, scoring and settle-up",
};

function listWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function reportCard(input: ReportCardInput | null, visibility: string): ReportCard {
  if (!input || visibility !== "public") return PRIVATE;
  if (input.cup) {
    return {
      kind: "report",
      club: input.club,
      event: input.event,
      label: input.completed ? "Final" : "So far",
      names: input.cup.score,
      figure: input.cup.verdict,
      highlight: input.highlight,
    };
  }
  const several = input.names.length > 1;
  const label =
    input.names.length === 0
      ? ""
      : input.completed
        ? several
          ? "Joint winners"
          : "Champion"
        : several
          ? "Lead"
          : "Leads";
  return {
    kind: "report",
    club: input.club,
    event: input.event,
    label,
    names: listWords(input.names),
    figure: input.figure,
    highlight: input.highlight,
  };
}

/**
 * The news line under the link: "Jane Doe wins the Spring Medal by 3 at Braid
 * Hollow". While it is played, "Jane Doe leads the Spring Medal"; nothing
 * named on a private board.
 */
export function reportNewsLine(input: ReportCardInput | null, visibility: string): string {
  if (!input || visibility !== "public") return "Golf results on TourneyHQ.";
  const at = input.venue ? ` at ${input.venue}` : "";
  const the = /^the /i.test(input.event) ? input.event : `the ${input.event}`;
  if (input.cup)
    return input.completed && input.cup.verdict
      ? `${input.cup.verdict}, ${input.cup.score}${at}.`
      : `${input.event}: ${input.cup.score} so far${at}.`;
  if (input.names.length === 0)
    return input.completed ? `The results of ${the}${at}.` : `The results so far of ${the}${at}.`;
  const who = listWords(input.names);
  if (!input.completed) return `${who} ${input.names.length > 1 ? "lead" : "leads"} ${the}${at}.`;
  if (input.names.length > 1) return `${who} share first place in ${the}${at}.`;
  return `${who} wins ${the}${input.margin ? ` ${input.margin}` : ""}${at}.`;
}
