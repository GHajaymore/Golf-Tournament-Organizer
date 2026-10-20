import { prisma } from "../db";
import { cupBoard } from "./cup";
import { cupPointsInPlay } from "../domain/cup";
import {
  countWords,
  halves,
  marginWords,
  nineWords,
  playerRecords,
  pointsTrack,
  reportRibbon,
  reportStory,
  scoringWords,
  sessionDescription,
  stars,
  type PlayerRecord,
  type ReportSession,
  type ReportSide,
  type ReportVerdict,
  type Star,
} from "../domain/final-report";

/**
 * A TEAM CUP'S FINAL REPORT (2026-10-19) — one page that tells the whole cup:
 * the score, the points track, the story, the format and field, every
 * session's matches, the points outside the matches, the players who won
 * every match they played, and every player's points.
 *
 * Built from the PUBLISHED cup board (`cupBoard` without `staff`), so a draft
 * lineup never reaches it, and the public report and the organizer's copy are
 * one answer. What the committee did along the way — a result amended, a
 * match recorded as halved, a point awarded — is in the change log and never
 * here (Ajay, 2026-10-19: "some of the organizer/committee actions should not
 * be shown"). The report states results, not how they came to be recorded.
 */

export interface FinalReportMatch {
  a: string;
  b: string;
  /** "3&2", "1 up", "halved", "Conceded"; "2 UP thru 5" while in play; "" before a shot. */
  label: string;
  winner: ReportSide | null;
  final: boolean;
}

export interface FinalReportSession {
  id: string;
  /** "Session 1 · Back nine". */
  eyebrow: string;
  /** The club's name for it, or its format. */
  title: string;
  tally: [number, number];
  matches: FinalReportMatch[];
}

export interface FinalReport {
  name: string;
  /** "Sunday 18 October 2026 · Four Bridges" — the dates and venue, each when known. */
  where: string;
  teams: [string, string];
  score: [number, number];
  verdict: ReportVerdict;
  /** "CDG win the cup"; empty while the cup is open. */
  ribbon: string;
  /** Points to win, and every point in the cup. */
  target: number;
  inPlay: number;
  track: ReturnType<typeof pointsTrack>;
  /** The organizer's own story when they have written one, otherwise the results'. */
  story: string[];
  storyByOrganizer: boolean;
  facts: Array<{ label: string; value: string }>;
  sessions: FinalReportSession[];
  outside: Array<{ label: string; points: number; side: ReportSide | null }>;
  stars: Star[];
  records: { A: PlayerRecord[]; B: PlayerRecord[]; most: number };
}

/** The organizer's story as paragraphs: a blank line between each. */
export function recapParagraphs(recap: string): string[] {
  return recap
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.replace(/\s*\r?\n\s*/g, " ").trim())
    .filter(Boolean);
}

/** The final report for a team cup, or null when the tournament is not one. */
export async function finalReport(eventId: string): Promise<FinalReport | null> {
  const [event, result] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { name: true, dates: true, course: true, reportRecap: true } }),
    cupBoard(eventId),
  ]);
  if (!event || !result.ok) return null;
  const board = result.board;
  const teams: [string, string] = [board.teams[0].name, board.teams[1].name];
  const shown = board.sessions.filter((s) => s.published && s.matches.length > 0);

  const sessions: ReportSession[] = shown.map((s) => ({
    name: s.name,
    matches: s.matches.map((m) => ({
      a: m.a,
      b: m.b,
      points: m.state.points,
      final: m.state.status === "final",
      label: m.state.label,
    })),
  }));

  const verdict: ReportVerdict =
    board.verdict.kind === "open" ? { kind: "open" } : board.verdict.kind === "tied" ? { kind: "tied" } : board.verdict;
  const score: [number, number] = [board.tally.a, board.tally.b];
  const outside = board.outside.map((o) => ({ label: o.label, points: o.points, side: o.side }));
  const inPlay = cupPointsInPlay(board.tally);

  const recap = recapParagraphs(event.reportRecap);
  const story = recap.length ? recap : reportStory({ teams, score, verdict, sessions, outside });

  const records = playerRecords(sessions);
  const perSide = (side: ReportSide) => records.filter((r) => r.side === side);
  const fieldA = perSide("A").length;
  const fieldB = perSide("B").length;

  const facts: Array<{ label: string; value: string }> = [
    {
      label: "Format",
      value: `Team match play, ${countWords(shown.length)} session${shown.length === 1 ? "" : "s"}`,
    },
    ...shown.map((s) => ({
      label: `Session ${board.sessions.indexOf(s) + 1}`,
      value: sessionDescription({ kind: s.kind, basis: s.basis, holes: s.holes, nine: s.nine }),
    })),
    ...outside.map((o) => ({ label: o.label, value: `${halves(o.points)} point${o.points === 1 ? "" : "s"}` })),
  ];
  if (fieldA + fieldB > 0) {
    facts.push({
      label: "Field",
      value:
        fieldA === fieldB
          ? `${fieldA + fieldB} players, ${fieldA} a side`
          : `${fieldA + fieldB} players: ${fieldA} ${teams[0]}, ${fieldB} ${teams[1]}`,
    });
  }
  facts.push({ label: "Scoring", value: scoringWords(shown.map((s) => s.keptBy)) });
  const captains = board.teams
    .map((t) => (t.captain ? `${t.captain} (${t.name})` : ""))
    .filter(Boolean);
  if (captains.length) {
    facts.push({ label: captains.length === 1 ? "Captain" : "Captains", value: captains.join(" and ") });
  }

  return {
    name: event.name,
    where: [event.dates.trim(), event.course.trim()].filter(Boolean).join(" · "),
    teams,
    score,
    verdict,
    ribbon: reportRibbon({ teams, verdict }),
    target: board.target,
    inPlay,
    track: pointsTrack({ a: score[0], b: score[1], outside, inPlay }),
    story,
    storyByOrganizer: recap.length > 0,
    facts,
    sessions: shown.map((s, i) => {
      const i1 = board.sessions.indexOf(s) + 1;
      const nine = nineWords(s.holes, s.nine);
      const decided = sessions[i].matches.filter((m) => m.final);
      return {
        id: s.id,
        eyebrow: `Session ${i1} · ${nine.charAt(0).toUpperCase()}${nine.slice(1)}`,
        title: s.name === `Session ${i1}` ? s.kind : s.name,
        tally: [
          decided.reduce((t, m) => t + m.points[0], 0),
          decided.reduce((t, m) => t + m.points[1], 0),
        ] as [number, number],
        matches: s.matches.map((m) => ({
          a: m.a.join(" & "),
          b: m.b.join(" & "),
          label: m.state.status === "final" ? marginWords(m.state.label) : m.state.label,
          winner: m.state.status === "final" ? m.state.leader : null,
          final: m.state.status === "final",
        })),
      };
    }),
    outside,
    stars: stars(sessions),
    records: { A: perSide("A"), B: perSide("B"), most: Math.max(0, ...records.map((r) => r.played)) },
  };
}

