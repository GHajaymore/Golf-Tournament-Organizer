import "server-only";
import { roundCourseHandicaps, flightTeeByPlayer } from "./handicaps";
import { prisma } from "../db";
import { findFormat, sideSizeRange } from "../formats";
import { holesPlayed } from "../domain/handicap";
import { roundHandicapOf } from "../domain/round-handicap";
import { roundHandicapRows } from "./round-handicap";
import { weekBasis, compareOnBasis } from "../domain/week-basis";
import { toParOnBasis } from "../domain/ranked-score";
import { teamMatchStandings, type TeamMatchStanding } from "../domain/team-match-standings";
import { isLeaguePointsSystem } from "../domain/league-meeting";
import type { HoleResult } from "../domain/types";
import {
  sideHandicap,
  committeeWeights,
  aggregateTeamCard,
  singleBallTeamCard,
  SCRAMBLE_WEIGHTS_2,
  SCRAMBLE_WEIGHTS_4,
} from "../domain/team";

export interface TeamMemberView {
  playerId: string;
  name: string;
  handicap: number;
  position: number;
  /**
   * WITHDRAWN AFTER THE SIDES WERE DRAWN — the ordinary Sunday morning.
   *
   * `removeSignup` keeps a player with playing history as `withdrawn` rather
   * than deleting them, and deliberately does NOT touch `TeamMember`: pulling
   * somebody out of a pair would destroy the draw a committee made, and the
   * committee is who decides whether to substitute or play short.
   *
   * But this reader did not carry the status at all, so nothing downstream
   * could see it. `teeSheetAsPlayed` drops a departed player so "a withdrawn
   * name never appears in a group", while their SIDE still listed them, still
   * counted them towards its size, and still priced its handicap off them.
   * Two readers of "who is playing", disagreeing — on the morning of the
   * competition, which is when a club can least afford it.
   */
  withdrawn: boolean;
}

export interface TeamView {
  id: string;
  name: string;
  seed: number;
  /** Null when the team plays the whole tournament rather than one round. */
  stageId: string | null;
  members: TeamMemberView[];
  /** The side's playing handicap under this round's format. */
  playingHandicap: number;
}

/**
 * Teams available to a round.
 *
 * Returns round-specific teams where they exist, and event-wide teams
 * otherwise — a member-guest draws its pairings once for the whole
 * tournament, a society redraws every week, and neither should have to know
 * which model the other uses.
 */
export async function teamsForStage(
  eventId: string,
  stageId: string,
  format: string,
  allowanceOverride = 0,
  holes = 18,
  weightsOverride?: number[] | null,
): Promise<TeamView[]> {
  // Side handicaps are built from Course Handicaps, not roster Indexes — a
  // foursomes pair off the blues receives different strokes to the same pair
  // off the reds, which is the whole reason tees are rated.
  const [tees, stage, event] = await Promise.all([
    prisma.tee.findMany({
      where: { course: { events: { some: { eventId } } } },
      orderBy: [{ position: "asc" }],
    }),
    /**
     * THE ROUND, because a side handicap is read out on the tee and has to
     * match the card the round is scored on.
     *
     * This resolved the set through `teeSetupFor` — one `Event.defaultTeeId`
     * for the whole tournament — so the seeded club's evening nine at Ardmore
     * had its pairings priced off Braid Hollow's championship whites, 129/70.8
     * against 96/58.6. A shared ball makes it worse rather than better: one
     * side handicap is the only number the pair receives all round.
     */
    prisma.stage.findUnique({
      where: { id: stageId },
      select: { holes: true, teeId: true, courseId: true },
    }),
    prisma.event.findUnique({
      where: { id: eventId },
      select: { defaultTeeId: true, courseId: true, teePolicy: true },
    }),
  ]);

  const rows = await prisma.team.findMany({
    where: { eventId, OR: [{ stageId }, { stageId: null }] },
    include: {
      members: {
        orderBy: { position: "asc" },
        include: {
          player: {
            select: {
              id: true,
              name: true,
              handicap: true,
              handicapType: true,
              teeId: true,
              // Who is actually playing. See `TeamMemberView.withdrawn`.
              status: true,
            },
          },
        },
      },
    },
    orderBy: [{ seed: "asc" }, { createdAt: "asc" }],
  });

  // A round that has its own teams uses only those; falling through to the
  // event-wide set as well would field every pairing twice.
  const scoped = rows.filter((t) => t.stageId === stageId);
  const use = scoped.length > 0 ? scoped : rows.filter((t) => t.stageId === null);

  const allMembers = use.flatMap((t) => t.members.map((m) => m.player));
  // A side's handicap is read out on the tee, so it has to be the one the
  // player's own flight plays off.
  const flightTee = await flightTeeByPlayer(eventId);
  const courseHcp = roundCourseHandicaps({
    tees,
    players: allMembers,
    flightTeeOf: flightTee,
    stage,
    event,
    /**
     * THE CALLER'S hole count, not the stage's, and that is deliberate. Every
     * caller of `teamsForStage` passes one, and some of them know about the
     * nine-hole wrap in a way this function does not. Changing which of the two
     * wins is a separate question from which TEES are read, and this commit
     * answers only the second.
     */
    holes,
  });
  // What this round says its players play off, on top of the tee conversion.
  // The side handicap shown here is the one an organizer reads out on the tee,
  // so it has to answer the same way the round is scored.
  const round = await roundHandicapRows(eventId, stageId);

  return use.map((t) => {
    const members = t.members.map((m) => ({
      playerId: m.playerId,
      name: m.player.name,
      handicap: roundHandicapOf(round.get(m.playerId), courseHcp.get(m.playerId) ?? m.player.handicap),
      position: m.position,
      withdrawn: m.player.status === "withdrawn",
    }));
    // Priced off the players who ACTUALLY PLAY — the same set `teamProblems`
    // sizes the side by. Including a withdrawn player anchors a single-ball
    // side (scramble/foursomes/greensomes) to strokes from somebody who never
    // hit a shot, so the net on the board disagreed with the "X has withdrawn"
    // warning beside it. If the whole side withdrew there is no card to score
    // anyway, so fall back to the full set rather than handicap off nobody.
    const playing = members.filter((m) => !m.withdrawn);
    const forHandicap = (playing.length > 0 ? playing : members).map((m) => m.handicap);
    return {
      id: t.id,
      name: t.name,
      seed: t.seed,
      stageId: t.stageId,
      members,
      playingHandicap: sidePlayingHandicap(forHandicap, format, allowanceOverride, weightsOverride),
    };
  });
}

/**
 * The side's playing handicap for a format.
 *
 * Scrambles use a descending share of each player's handicap rather than a
 * flat percentage of the combined total — a four whose handicaps sum to 72
 * would otherwise be given a wildly different allowance depending on how the
 * percentage was applied. Everything else takes the format's allowance against
 * the combined handicaps, which is how foursomes' 50% is meant to work.
 */
export function sidePlayingHandicap(
  courseHandicaps: number[],
  format: string,
  allowanceOverride = 0,
  weightsOverride?: number[] | null,
): number {
  const f = findFormat(format);
  // A committee's own split is the most specific thing they can say, so it
  // wins: it is only ever settable on formats that use one, and a club that
  // has typed "55 / 45" has said something a single percentage cannot.
  const committee = committeeWeights(weightsOverride, courseHandicaps.length);
  if (committee) return sideHandicap(courseHandicaps, 0, committee);
  // A flat override replaces the whole scheme, including the scramble
  // weights: a committee that says "40%" means 40% of the combined handicaps,
  // not 40% layered on top of a descending table they never mentioned.
  if (allowanceOverride > 0) return sideHandicap(courseHandicaps, allowanceOverride);
  // A format that declares per-player shares (greensomes' 60/40) is scored by
  // that split, not by a flat percentage of the combined handicaps — applying
  // `allowance` here instead would hand the side far too many shots.
  const declared = f.weightsBySideSize?.[courseHandicaps.length];
  if (declared) return sideHandicap(courseHandicaps, 0, declared);
  if (/scramble/i.test(f.name)) {
    const weights = courseHandicaps.length > 2 ? SCRAMBLE_WEIGHTS_4 : SCRAMBLE_WEIGHTS_2;
    return sideHandicap(courseHandicaps, 0, weights);
  }
  return sideHandicap(courseHandicaps, f.allowance);
}

/** The allowance actually in force for a round: the committee's, or the
 *  format's recommendation when they haven't set one. */
export function effectiveAllowance(format: string, override: number): number {
  return override > 0 ? override : findFormat(format).allowance;
}

/**
 * How many partners' scores count on each hole for this round.
 *
 * Zero means the organizer has said nothing, which is one — the single best
 * ball, as four-ball and best ball are normally played. A stored zero must
 * never read as "count none", which would score every hole as blank.
 *
 * Capped at the number of players a side can hold: "best 6 of 4" is not a
 * format, and letting it through would just be a confusing way of writing
 * "everyone counts".
 */
export function effectiveCountBest(format: string, override: number): number {
  if (!Number.isFinite(override) || override <= 0) return 1;
  return Math.min(Math.round(override), sideSizeRange(format).max);
}

export interface TeamProblem {
  teamId: string;
  teamName: string;
  problem: string;
}

/**
 * Sides that can't play the round as configured.
 *
 * Surfaced before a round starts rather than at scoring time, because a
 * three-player scramble discovered on the first tee is an organizer's problem
 * and a three-player scramble discovered on Saturday morning is a crisis.
 */
export function teamProblems(teams: TeamView[], format: string): TeamProblem[] {
  const { min, max } = sideSizeRange(format);
  const problems: TeamProblem[] = [];
  for (const t of teams) {
    /**
     * A WITHDRAWN PLAYER IS NOT A PLAYER, and this counted them.
     *
     * The ordinary last-minute change: somebody pulls out on the morning and
     * the committee substitutes from the reserves or sends the side out short.
     * `removeSignup` marks them `withdrawn` and leaves the draw alone, which is
     * right — but this function is the one that exists to tell a committee a
     * side is not right, and it could not see it. A pair reduced to one read
     * as a complete pair, so nothing on the Teams screen said anything and the
     * side went out unnoticed.
     *
     * Reported SEPARATELY from being short, because they are different jobs
     * for the committee: "has 1 of 2 players" is a draw that was never
     * finished, and this is a draw that was finished and has since changed.
     */
    const gone = t.members.filter((m) => m.withdrawn);
    if (gone.length > 0) {
      problems.push({
        teamId: t.id,
        teamName: t.name,
        problem:
          gone.length === 1
            ? `${gone[0].name} has withdrawn — substitute or play short`
            : `${gone.map((m) => m.name).join(" and ")} have withdrawn — substitute or play short`,
      });
    }

    // Size is judged on who is actually playing: a pair whose partner has
    // withdrawn IS one short, and saying so is the point of this function.
    const n = t.members.filter((m) => !m.withdrawn).length;
    if (n < min) {
      problems.push({
        teamId: t.id,
        teamName: t.name,
        problem: n === 0 ? "has no players" : `has ${n} of ${min} players`,
      });
    } else if (n > max) {
      problems.push({ teamId: t.id, teamName: t.name, problem: `has ${n} players, more than ${max}` });
    }
  }
  return problems;
}

/** Players entered in the tournament who aren't on any side for this round. */
export async function unassignedPlayers(
  eventId: string,
  teams: TeamView[],
): Promise<{ id: string; name: string; handicap: number }[]> {
  const taken = new Set(teams.flatMap((t) => t.members.map((m) => m.playerId)));
  const players = await prisma.player.findMany({
    where: { eventId, status: "confirmed" },
    select: { id: true, name: true, handicap: true },
    orderBy: { seed: "asc" },
  });
  return players.filter((p) => !taken.has(p.id));
}

export interface TeamStanding {
  teamId: string;
  name: string;
  members: string[];
  /**
   * The same members, by id — so a screen can ask "is this side mine?".
   *
   * Names are for reading and ids are for deciding: two members of a club can
   * share a name, and every score guard in this app links a person by id or by
   * registration email for exactly that reason. A player's own Today screen
   * needs to find their side, and finding it by name would put somebody else's
   * result on their phone.
   */
  memberIds: string[];
  playingHandicap: number;
  gross: number;
  net: number;
  points: number;
  played: number;
  toPar: number;
}

/**
 * Standings for a team round.
 *
 * Ranks sides rather than players, which is the whole point — in a scramble
 * nobody has an individual score to rank, and in a four-ball an individual
 * score is only half the story.
 *
 * Sides that haven't returned anything sort last rather than tying for first
 * on a gross of zero, which is what a naive ascending sort would do.
 */
export async function teamStandings(
  eventId: string,
  stageId: string,
  format: string,
  pars: number[],
  strokeIndex: number[],
  basis: string,
  allowanceOverride = 0,
  weightsOverride?: number[] | null,
  countBestOverride = 0,
): Promise<TeamStanding[]> {
  const f = findFormat(format);
  const [teams, cards] = await Promise.all([
    // The card's own length. This passed a hard 18 until 2026-08-09, which
    // priced a nine-hole team round off eighteen-hole handicaps.
    teamsForStage(eventId, stageId, format, allowanceOverride, holesPlayed(pars.length), weightsOverride),
    prisma.teamScorecard.findMany({ where: { eventId, stageId } }),
  ]);

  const parse = (s: string): (number | null)[] => {
    try {
      return JSON.parse(s) as (number | null)[];
    } catch {
      return [];
    }
  };

  const rows = teams.map((t) => {
    const own = cards.filter((c) => c.teamId === t.id);
    const card =
      f.ball === "single"
        ? singleBallTeamCard(
            parse(own.find((c) => c.playerId === "")?.strokes ?? "[]"),
            pars,
            t.playingHandicap,
            strokeIndex,
          )
        : aggregateTeamCard(
            t.members.map((m) => ({
              playerId: m.playerId,
              strokes: parse(own.find((c) => c.playerId === m.playerId)?.strokes ?? "[]"),
              courseHandicap: m.handicap,
            })),
            pars,
            strokeIndex,
            effectiveAllowance(format, allowanceOverride),
            effectiveCountBest(format, countBestOverride),
          );
    return {
      teamId: t.id,
      name: t.name,
      members: t.members.map((m) => m.name),
      memberIds: t.members.map((m) => m.playerId),
      playingHandicap: t.playingHandicap,
      gross: card.grossTotal,
      net: card.netTotal,
      points: card.pointsTotal,
      played: card.played,
      /**
       * THE TO-PAR OF THE FIGURE THIS BOARD IS RANKED ON.
       *
       * `aggregateTeamCard` and `singleBallTeamCard` both return
       * `grossTotal - parPlayed`, so this column was the GROSS to-par on a
       * board sorted by NET — which means the column cannot be read downward,
       * and two sides level on net print different numbers. Measured on the
       * seeded club's Invitational foursomes, 2026-09-22:
       *
       *     Nkechi & Rafe    gross 31   net 28   shown -1
       *     Kwame & Greta          32       28   shown  E
       *     Toby & Dilip           36       35   shown +4
       *     Hattie & Gordon        37       35   shown +5
       *
       * It is the same defect `ranked-score.ts` records for the individual
       * board (#557) and fixed there; the team board never went through it.
       *
       * FIXED IN THE ENGINE RATHER THAN IN THE TABLE, because `teamStandings`
       * has EIGHT callers — the console board, `/live`, Reports, the week
       * sheet, the tournament result and three player screens — and a rule
       * applied in one of them is a rule the other seven disagree with. It is
       * also the only place that knows the basis, since it is the thing that
       * sorted the rows.
       *
       * The NEGATIVE test is deliberate: `scoringBasis` accepts more values
       * than gross/net, and every one of the others is scored off handicap
       * strokes, so an unknown value takes the net branch. CLAUDE.md records
       * the afternoon a tidier `isNetBasis` silenced the stableford rounds.
       */
      toPar: toParOnBasis(
        { toPar: card.toPar, gross: card.grossTotal, net: card.netTotal },
        // The NEGATIVE test is deliberate: `scoringBasis` accepts more values
        // than gross/net and every other one is scored off handicap strokes,
        // so an unknown value takes the net branch. CLAUDE.md records the
        // afternoon a tidier `isNetBasis` silenced the stableford rounds.
        basis.trim().toLowerCase() !== "gross",
      ),
    };
  });

  /**
   * RANKED ON WHAT THE ROUND IS ACTUALLY DECIDED ON, which for a year meant
   * "points if Stableford, otherwise net" — with no gross branch at all.
   *
   * A gross team round is an ordinary thing: a scratch Am-Am, a club's gross
   * scramble. Every one of them was ordered by NET while its own screens said
   * "gross strokes" at the top, so the side with the lowest gross was not the
   * side printed first. Read off the seeded festival's gross scramble on
   * 2026-09-20: 69, 71, 70, 72 down the page, in net order.
   *
   * `compareOnBasis` is the same comparison the individual boards use, so a
   * gross team round and a gross medal now agree about which way is winning.
   */
  const order = weekBasis(basis, format);
  return rows.sort((a, b) => {
    // A side with no card yet has nothing to rank, and a gross of zero would
    // otherwise put it top.
    if (a.played === 0 !== (b.played === 0)) return a.played === 0 ? 1 : -1;
    return compareOnBasis(order, a, b) || a.name.localeCompare(b.name);
  });
}

/**
 * A ROUND ROBIN OF TEAM MATCHES, RANKED ON THE MATCHES.
 *
 * The sibling of `teamStandings` and the one a HEAD-TO-HEAD team round wants:
 * that function ranks sides on their cards, which is right for a better-ball
 * medal and throws away every result in a round of matches. Measured on a
 * four-ball round robin — the side that won 10&8 placed second, behind the
 * side with the lower stroke total.
 *
 * All the golf is borrowed. `teamMatchStandings` aggregates, `pairingPoints`
 * decides what a match is worth, and both were already in the app. What this
 * adds is the reading of rows and the names.
 *
 * THE SYSTEM IS THE CLUB'S WHERE THEY HAVE CHOSEN ONE. Ajay's ruling: "go with
 * what other golf club do and what is the standard (plus customization)". The
 * standard is one point a win and a half each for a half — what
 * `league-meeting.ts` calls the simplest — and a club that has set
 * `leaguePoints` has already said how it counts match points, so that answer
 * is honoured rather than a second setting being invented for it.
 */
export interface TeamMatchRow extends TeamMatchStanding {
  name: string;
  members: string[];
}

export async function teamMatchBoard(
  eventId: string,
  stageId: string,
  format: string,
  allowanceOverride = 0,
  holes = 18,
  weightsOverride?: number[] | null,
): Promise<TeamMatchRow[]> {
  const [teams, matches, event] = await Promise.all([
    teamsForStage(eventId, stageId, format, allowanceOverride, holes, weightsOverride),
    prisma.match.findMany({
      where: { eventId, stageId, NOT: { teamAId: "" } },
      select: { teamAId: true, teamBId: true, holes: true },
    }),
    prisma.event.findUnique({ where: { id: eventId }, select: { leaguePoints: true } }),
  ]);

  const pairings = matches.map((m) => {
    let holeResults: HoleResult[] = [];
    try {
      holeResults = JSON.parse(m.holes) as HoleResult[];
    } catch {
      // An unreadable card is not a finished match, and a throw here would
      // take the whole board down over one row.
      holeResults = [];
    }
    return { teamAId: m.teamAId, teamBId: m.teamBId, holes: holeResults };
  });

  const system = isLeaguePointsSystem(event?.leaguePoints) ? event.leaguePoints : "match";
  const rows = teamMatchStandings(
    teams.map((t) => t.id),
    pairings,
    system,
  );
  const byId = new Map(teams.map((t) => [t.id, t]));
  return rows.map((r) => ({
    ...r,
    name: byId.get(r.teamId)?.name ?? "",
    members: byId.get(r.teamId)?.members.map((m) => m.name) ?? [],
  }));
}

/**
 * Draw sides automatically, pairing strongest with weakest.
 *
 * A snake draw keeps sides comparable, which is what a charity day or a
 * member-guest actually wants — random sides in a field with a 25-shot spread
 * produce a winner decided at registration rather than on the course.
 */
export function snakeDraw<T extends { id: string; handicap: number }>(
  players: T[],
  sideSize: number,
  /**
   * What sizes this format will actually accept, when it accepts a range.
   *
   * Defaults to exactly `sideSize`, which is what every caller meant before
   * this existed and leaves their behaviour unchanged.
   *
   * WHY THE DRAW NEEDS IT. Sides are filled round-robin, so they end up within
   * one of each other and the smallest is `floor(n / sideCount)`. With
   * `sideCount = ceil(n / sideSize)` that lands BELOW the format's minimum
   * whenever the remainder is small — and the app then reports the side it
   * just drew as broken:
   *
   *     Best Ball, 3 players -> [1, 2]   "Team 1 has 1 of 2 players"
   *     Best Ball, 5 players -> [1, 2, 2]
   *
   * Best ball is playable 2 to 4, so three players are one perfectly ordinary
   * side of three. The draw had no way to know that, because it was only ever
   * told one number.
   *
   * It is NOT always avoidable, and must not pretend otherwise: four-ball and
   * foursomes are exactly two a side, so an odd field has no legal shape at
   * all and somebody genuinely has no partner. Where no side count works, this
   * falls back to the old answer and leaves `teamProblems` to say so — which
   * is the app being right rather than the app being quiet.
   */
  range?: { min: number; max: number },
): T[][] {
  const ordered = [...players].sort((a, b) => a.handicap - b.handicap);
  const min = range?.min ?? sideSize;
  const max = range?.max ?? sideSize;

  /**
   * The most sides that keeps every one of them inside the range.
   *
   * Counting DOWN from the ideal rather than up, so a format that fits its
   * preferred size exactly keeps it: 16 players at 4 a side still draws four
   * fours, because that is the first count tried and it is already legal.
   */
  let sideCount = Math.ceil(ordered.length / sideSize) || 0;
  for (let k = sideCount; k >= 1; k -= 1) {
    const smallest = Math.floor(ordered.length / k);
    const largest = Math.ceil(ordered.length / k);
    if (smallest >= min && largest <= max) {
      sideCount = k;
      break;
    }
  }
  if (sideCount === 0) return [];
  const sides: T[][] = Array.from({ length: sideCount }, () => []);
  ordered.forEach((p, i) => {
    const row = Math.floor(i / sideCount);
    const col = i % sideCount;
    // Alternate direction each pass, so the best player and the weakest end up
    // together rather than all the low handicaps landing on side one.
    sides[row % 2 === 0 ? col : sideCount - 1 - col].push(p);
  });
  return sides;
}
