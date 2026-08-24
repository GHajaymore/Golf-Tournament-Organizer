import { prisma } from "@/lib/db";
import { hasFeature } from "@/lib/plans";
import { planForEvent } from "@/lib/services/entitlements";
import { boardKind } from "@/lib/formats";
import { isPlayingRound } from "@/lib/stage-types";
import { resolveCourse } from "@/lib/courses";
import { teamStandings } from "@/lib/services/teams";
import { COURSE_REF } from "@/lib/services/course-resolution";
import { seasonStandings, seasonTotals, type SeasonRow } from "@/lib/domain/season";

export interface SeasonTable {
  /** False when the club's plan does not include the season table. */
  allowed: boolean;
  /** Why not, in words a club can act on. Empty when allowed. */
  reason: string;
  rows: SeasonRow[];
  totals: { teams: number; roundsPlayed: number; points: number };
  /** Rounds that contributed, which is not always every round on the card. */
  rounds: number;
}

const LOCKED =
  "The season table comes with the paid plan. Each round still has its own " +
  "board — this is the one that adds them up across the weeks.";

const EMPTY: SeasonTable = {
  allowed: true,
  reason: "",
  rows: [],
  totals: { teams: 0, roundsPlayed: 0, points: 0 },
  rounds: 0,
};

/**
 * The season table for one league, or the reason there isn't one.
 *
 * THE GATE IS HERE, at the point the table is actually produced, rather than
 * on the screen that shows it. A check a caller has to remember is a check a
 * caller will forget — the same reasoning that put `isManualFormat` in
 * CLAUDE.md as a warning. Any future screen, export or public board calling
 * this gets the gate for free and cannot route around it by accident.
 *
 * A locked plan gets `allowed: false` and NO rows. Not an empty table that
 * looks like a season nobody played, and not rows that a caller is trusted to
 * hide: an unpaid club must not be able to read the numbers out of the
 * response either.
 */
export async function seasonTableFor(eventId: string): Promise<SeasonTable> {
  if (!hasFeature(await planForEvent(eventId), "seasonStandings")) {
    return { ...EMPTY, allowed: false, reason: LOCKED, rows: [] };
  }

  /**
   * COURSE_REF, so the card is resolved from the event's course ID.
   *
   * Without the join `resolveCourse` falls back to matching the course NAME,
   * which is exactly how a tournament came to be scored against another
   * course's stroke index — same par, different allocation, and nothing on
   * any screen looking wrong. `course-by-id.test.ts` caught this file the
   * moment it was written, which is the whole point of that guard.
   */
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: COURSE_REF,
  });
  if (!event) return EMPTY;

  const stages = await prisma.stage.findMany({
    where: { eventId },
    orderBy: { position: "asc" },
  });

  const course = resolveCourse(event);

  /**
   * Only rounds that are actually played, and only team rounds.
   *
   * A cut or a seeding round is not a week of the league, and a round whose
   * format has no team engine has no team standing to add in. Including
   * either would put a zero in every side's total and quietly change the
   * order of the table.
   */
  const rounds = stages.filter((s) => isPlayingRound(s.type) && boardKind(s.format) === "team");

  const perRound = await Promise.all(
    rounds.map((s) => {
      const holeCount = s.holes === 9 ? 9 : 18;
      return teamStandings(
        eventId,
        s.id,
        s.format,
        course.pars.slice(0, holeCount),
        course.strokeIndex.slice(0, holeCount),
        s.scoringBasis,
        s.handicapAllowance,
        s.allowanceWeights,
        s.countBest,
      );
    }),
  );

  // The basis of the rounds themselves, so the season is ordered the way the
  // weeks were scored. Mixed bases across a season is a club's own choice;
  // the first round's basis is the one the table states.
  const basis = rounds[0]?.scoringBasis ?? "net";
  const rows = seasonStandings(perRound, basis);

  return {
    allowed: true,
    reason: "",
    rows,
    totals: seasonTotals(rows),
    rounds: rounds.length,
  };
}
