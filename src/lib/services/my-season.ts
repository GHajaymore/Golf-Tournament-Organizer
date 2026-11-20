import "server-only";
import { prisma } from "../db";
import { byAddress } from "../domain/my-entry";
import { clubToday } from "../domain/club-clock";
import { currentSeason, seasonWindow, type Season } from "../domain/club-season";
import {
  entryWords,
  heldAPlace,
  inSeason,
  seasonBests,
  strongestEntry,
  type CountedResult,
  type SeasonBest,
  type SeasonEntry,
} from "../domain/my-season";
import { playerAppShut } from "../domain/lifecycle-state";
import { money, minorUnitDigits } from "../domain/money-format";
import { canSeeLeaderboard } from "../tournament-settings";
import { isPlayingRound } from "../stage-types";
import { clubEventsFor } from "./club-events";
import { liveBoard, type LiveBoardView } from "./live-board";
import { reportPlace, reportStandings, unrankedWords } from "./event-report";
import { organizationAllows } from "./entitlements";
import { formattingForEvent, organizationsFor } from "./organization";
import { settingsOf } from "./tournament";
import { TEAM_SESSION } from "./cup";

/**
 * ONE MEMBER'S SEASON AT THEIR CLUB (Ajay, 2026-10-24) — read-only, and built
 * only from what the app already holds.
 *
 * NOTHING IS WORKED OUT HERE THAT A BOARD ALREADY SAYS. A tournament's place
 * and figures are the public board's own (`liveBoard`, at its default view),
 * placed by `reportStandings` — the reading the tournament's final report
 * makes — so if the board ranks somebody T3 this says T3, and if the report
 * prints gross 80 this says 80. What is added is only what a season adds:
 * which tournaments are in it, how many rounds the member played, and the best
 * of their figures.
 *
 * EVERY RULE THE BOARD FOLLOWS, this follows:
 *
 *   held results     a board the club has not published to its players
 *                    (`canSeeLeaderboard` for a player) shows no place, no
 *                    figure, no prize and no honour — and counts toward no best
 *   a closed door    a tournament the player app is shut on is held the same way
 *   hand-scored      the board ranks nobody, so nor does this
 *   money            a prize's amount only once the tournament is completed,
 *                    and only the member's own
 *   the entry        somebody waiting for a place is said to be waiting —
 *                    never "not entered"
 *
 * THE SEASON is the club's own window (`Organization.seasonStartsOn` /
 * `seasonEndsOn`, the one Events groups by), which is the calendar year when
 * the club has not said, on the CLUB's day (`clubToday`), never the server's.
 *
 * THE CLUB is the one the member is looking at — the club of the tournament
 * that is active, as every other `/me` screen follows it.
 */

export interface SeasonFigure {
  label: "Gross" | "Net" | "Points" | "Played";
  value: string;
}

export type SeasonResult =
  /** A place on a board of players: "T2", with the board's own word for how final it is. */
  | { kind: "place"; place: string; state: string; figures: SeasonFigure[] }
  /** A team round: the SIDE's place, said as the side's. */
  | { kind: "side"; place: string; side: string; state: string; figures: SeasonFigure[] }
  /** On the board without a position, in the board's own words: "Missed the cut after Round 1". */
  | { kind: "unplaced"; note: string }
  /** The club has not published this tournament's results to its players. */
  | { kind: "held" }
  /** A round the committee scores by hand — the app ranks nobody in it. */
  | { kind: "manual" }
  /** A board that is not a table of places — a cup, a knockout's draw, skins. */
  | { kind: "board"; note: string }
  /** No result to show: waiting, entered with nothing played, withdrew. */
  | { kind: "entry"; note: string };

export interface SeasonEvent {
  eventId: string;
  name: string;
  /** When it is played, as Events words it. */
  dates: string;
  startOn: string;
  entry: SeasonEntry;
  /** Rounds this member has holes on a card in. */
  rounds: number;
  result: SeasonResult;
  /** Prizes and contests the committee recorded this member as winning. */
  prizes: Array<{ what: string; amount: string }>;
  /** A confirmed honours-board line in this member's name, or "". */
  honour: string;
}

export interface MySeason {
  clubName: string;
  /** "2026", or "2026–27" for a season across the new year. Null when the club's day cannot be read. */
  season: Season | null;
  events: SeasonEvent[];
  /** Tournaments the member held a place in. */
  tournaments: number;
  rounds: number;
  /** Prizes, contests and honours won. */
  wins: number;
  /** The best figures, and the number of holes they were compared over. */
  bests: SeasonBest[];
  bestHoles: number;
}

const EMPTY = (clubName: string, season: Season | null): MySeason => ({
  clubName,
  season,
  events: [],
  tournaments: 0,
  rounds: 0,
  wins: 0,
  bests: [],
  bestHoles: 0,
});

/** Whether a stored card has any hole on it. */
function hasHole(json: string): boolean {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) && v.some((h) => h != null);
  } catch {
    return false;
  }
}

/** The board's chip, word for word: Final once the committee has closed it, All in, or Live. */
function stateWord(board: LiveBoardView): string {
  return board.official ? "Final" : board.allIn ? "All in" : "Live";
}

export async function mySeasonFor(email: string, activeEventId: string): Promise<MySeason> {
  // The club in front of the member: the active tournament's, else the first they belong to.
  const active = activeEventId
    ? await prisma.event.findUnique({ where: { id: activeEventId }, select: { organizationId: true } })
    : null;
  const organizationId = active?.organizationId ?? (await organizationsFor(email))[0]?.organizationId ?? "";
  const club = organizationId
    ? await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, timeZone: true, seasonStartsOn: true, seasonEndsOn: true },
      })
    : null;
  if (!club) return EMPTY("", null);

  const window = seasonWindow(club.seasonStartsOn, club.seasonEndsOn);
  const season = currentSeason(clubToday(club.timeZone), window);

  // The club's tournaments as Events lists them — casual rounds and empty drafts already out.
  const listed = await clubEventsFor(email);
  const ids = listed.map((r) => r.eventId);
  const [events, mine] = await Promise.all([
    prisma.event.findMany({ where: { id: { in: ids }, organizationId } }),
    prisma.player.findMany({
      where: { eventId: { in: ids }, ...byAddress(email) },
      select: { id: true, eventId: true, status: true },
    }),
  ]);
  const eventById = new Map(events.map((e) => [e.id, e]));
  const rows = listed.filter((r) => eventById.has(r.eventId) && inSeason(r.startOn, season, window));

  // A tournament is on THIS member's season only if their address is in its field.
  const entryOf = new Map<string, SeasonEntry>();
  for (const r of rows) {
    const entry = strongestEntry(mine.filter((p) => p.eventId === r.eventId).map((p) => p.status));
    if (entry) entryOf.set(r.eventId, entry);
  }
  const theirs = rows.filter((r) => entryOf.has(r.eventId));
  if (theirs.length === 0) return EMPTY(club.name, season);

  const eventIds = theirs.map((r) => r.eventId);
  const myIds = mine.filter((p) => entryOf.has(p.eventId)).map((p) => p.id);
  const idsIn = (eventId: string) => new Set(mine.filter((p) => p.eventId === eventId).map((p) => p.id));

  const [stages, cards, sideSeats, matches, prizes, contestWins, honours, honoursOn] = await Promise.all([
    prisma.stage.findMany({ where: { eventId: { in: eventIds } }, select: { id: true, eventId: true, type: true } }),
    prisma.scorecard.findMany({ where: { playerId: { in: myIds } }, select: { eventId: true, stageId: true, strokes: true } }),
    prisma.teamMember.findMany({ where: { playerId: { in: myIds } }, select: { teamId: true } }),
    prisma.match.findMany({
      where: { eventId: { in: eventIds }, OR: [{ playerAId: { in: myIds } }, { playerBId: { in: myIds } }] },
      select: { eventId: true, stageId: true, holes: true },
    }),
    prisma.prize.findMany({
      where: { eventId: { in: eventIds }, winnerId: { in: myIds } },
      orderBy: { position: "asc" },
      select: { eventId: true, category: true, amount: true },
    }),
    prisma.contestEntry.findMany({
      where: { playerId: { in: myIds }, won: true, contest: { eventId: { in: eventIds } } },
      select: { contest: { select: { eventId: true, name: true } } },
    }),
    prisma.honoursEntry.findMany({
      where: { organizationId, eventId: { in: eventIds }, playerId: { in: myIds } },
      select: { eventId: true, note: true },
    }),
    organizationAllows(organizationId, "honours"),
  ]);
  // A side's card is filed on the side — for a shared ball, once for the whole side.
  const teamCards = sideSeats.length
    ? await prisma.teamScorecard.findMany({
        where: { eventId: { in: eventIds }, teamId: { in: sideSeats.map((s) => s.teamId) } },
        select: { eventId: true, stageId: true, strokes: true },
      })
    : [];

  /** The rounds of golf a member has holes on a card in, per tournament. */
  const playing = new Set(stages.filter((s) => isPlayingRound(s.type)).map((s) => s.id));
  const playedIn = new Map<string, Set<string>>();
  const played = (eventId: string, stageId: string) => {
    if (!playing.has(stageId)) return;
    playedIn.set(eventId, (playedIn.get(eventId) ?? new Set()).add(stageId));
  };
  for (const c of [...cards, ...teamCards]) if (hasHole(c.strokes)) played(c.eventId, c.stageId);
  for (const m of matches) if (hasHole(m.holes)) played(m.eventId, m.stageId);
  const cup = new Set(stages.filter((s) => s.type === TEAM_SESSION).map((s) => s.eventId));

  const counted: CountedResult[] = [];
  const out: SeasonEvent[] = [];

  for (const row of theirs) {
    const event = eventById.get(row.eventId)!;
    const entry = entryOf.get(row.eventId)!;
    const rounds = playedIn.get(row.eventId)?.size ?? 0;
    const own = idsIn(row.eventId);
    const base = { eventId: row.eventId, name: row.name, dates: row.dates, startOn: row.startOn, entry, rounds };

    // Waiting for a place, or nothing to look at yet: the entry is the whole line.
    if (!heldAPlace(entry) || (entry === "confirmed" && rounds === 0)) {
      out.push({
        ...base,
        result: { kind: "entry", note: entryWords(entry, rounds, event.status === "completed") },
        prizes: [],
        honour: "",
      });
      continue;
    }

    // RESULTS HELD — the board's own rule, asked as a player. A winner's name is a result too.
    const shown = canSeeLeaderboard(settingsOf(event), "player") && !playerAppShut(event, false);
    if (!shown) {
      out.push({ ...base, result: { kind: "held" }, prizes: [], honour: "" });
      continue;
    }

    const { locale, currency } = await formattingForEvent(row.eventId);
    const final = event.status === "completed";
    const prizeAmount = (amount: number) =>
      final && amount > 0 ? money(Math.round(amount * 10 ** minorUnitDigits(currency)), currency, locale) : "";
    const won = [
      ...prizes.filter((p) => p.eventId === row.eventId).map((p) => ({ what: p.category, amount: prizeAmount(p.amount) })),
      ...contestWins.filter((c) => c.contest.eventId === row.eventId).map((c) => ({ what: c.contest.name, amount: "" })),
    ];
    const honour = honoursOn && honours.some((h) => h.eventId === row.eventId) ? "Champion" : "";

    // Not on the board at all — a withdrawal before a shot, say — is said as the entry.
    const result = (await resultOn(row.eventId, own, cup.has(row.eventId), final, counted)) ?? {
      kind: "entry" as const,
      note: entryWords(entry, rounds, final),
    };
    out.push({ ...base, result, prizes: won, honour });
  }

  const { holes, bests } = seasonBests(counted);
  // Newest first: the season as it has gone, most recent at the top.
  out.sort((a, b) => b.startOn.localeCompare(a.startOn));
  return {
    clubName: club.name,
    season,
    events: out,
    tournaments: out.filter((e) => heldAPlace(e.entry)).length,
    rounds: out.reduce((n, e) => n + e.rounds, 0),
    wins: out.reduce((n, e) => n + e.prizes.length + (e.honour ? 1 : 0), 0),
    bests,
    bestHoles: holes,
  };
}

/**
 * The member's line on one tournament's board — the public board's view, read
 * the way its final report reads it. `counted` collects the complete,
 * single-round results the season's best figures are taken from.
 */
async function resultOn(
  eventId: string,
  own: Set<string>,
  cup: boolean,
  completed: boolean,
  counted: CountedResult[],
): Promise<SeasonResult | null> {
  if (cup) return { kind: "board", note: "Team cup · see the board" };
  const board = await liveBoard(eventId);
  if (!board) return { kind: "board", note: "See the board" };
  if (board.manualFormat) return { kind: "manual" };
  if (board.draws.length > 0) return { kind: "board", note: "Knockout · see the draw" };

  const standing = reportStandings(board);
  const state = stateWord(board);

  if (standing.team) {
    const at = standing.sides.findIndex((s) => s.memberIds.some((id) => own.has(id)));
    if (at < 0) return null;
    const side = standing.sides[at];
    if (!standing.sidePlaces[at]) return { kind: "unplaced", note: side.played === 0 ? "No return" : "Not placed" };
    // The report's own columns for a side: points and gross on a Stableford, gross and net otherwise.
    const figures: SeasonFigure[] =
      standing.teamBasis === "stableford"
        ? [
            { label: "Points", value: String(side.points) },
            { label: "Gross", value: String(side.gross) },
          ]
        : [
            { label: "Gross", value: String(side.gross) },
            { label: "Net", value: String(side.net) },
          ];
    return { kind: "side", place: standing.sidePlaces[at], side: side.name, state, figures };
  }

  // A round that ranks something other than players' cards: skins, a Nassau, team matches.
  if (!standing.individual || (board.kind !== "standard" && board.kind !== "team")) {
    return { kind: "board", note: "See the board" };
  }
  const row = standing.rows.find((r) => own.has(r.id));
  if (!row) return null;
  const place = reportPlace(row, standing.shared);
  if (!place) return { kind: "unplaced", note: unrankedWords(row, completed) };

  // The report's own columns: played and points for match play; points and
  // gross on a Stableford board; gross and net on a stroke one.
  if (!board.isStroke) {
    return {
      kind: "place",
      place,
      state,
      figures: [
        { label: "Played", value: String(row.played) },
        { label: "Points", value: row.pts },
      ],
    };
  }
  const figures: SeasonFigure[] = board.isStableford
    ? [
        { label: "Points", value: String(row.points) },
        { label: "Gross", value: String(row.gross) },
      ]
    : [
        { label: "Gross", value: String(row.gross) },
        { label: "Net", value: String(row.net) },
      ];
  /**
   * A BEST IS ONE ROUND'S CARD, complete. A tournament of several rounds prints
   * their total, which is not a round; a card that stopped short is not one either.
   */
  if (board.rounds.length <= 1 && row.thru >= board.holeCount && board.holeCount > 0) {
    counted.push({
      holes: board.holeCount,
      gross: row.gross,
      net: board.isStableford ? null : row.net,
      points: board.isStableford ? row.points : null,
    });
  }
  return { kind: "place", place, state, figures };
}
