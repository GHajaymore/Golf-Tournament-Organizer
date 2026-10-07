import { prisma } from "@/lib/db";
import { matchLine } from "@/lib/domain/match-line";
import type { HoleResult } from "@/lib/domain/types";
import { standingRows, type EventState } from "@/lib/services/tournament";
import { usesStandardBoard, boardKind } from "@/lib/formats";
import { modifiedStablefordBoard, type ModStablefordRow } from "@/lib/services/points-standings";
import { isStablefordRound } from "@/lib/domain/week-basis";
import type { StandingRow } from "@/components/LeaderboardTable";
import { moneyFor, roundMoneyFor, nassauStagesIn } from "@/lib/services/expenses";
import { money } from "@/lib/domain/money-format";
import { formattingForEvent } from "@/lib/services/organization";

/**
 * WHAT A CASUAL ROUND'S ONE SCREEN SAYS UNDER THE CARD (Ajay, 2026-10-06):
 * "casual round should be just one screen including score entry for the
 * foursome". So where it stands, and the money once it is final, sit on the
 * screen the card is kept on — not on a dashboard one tab away.
 *
 * MOVED, NOT REWRITTEN. Every reader here was the casual half of `/dashboard`,
 * which now sends a casual round to `/entry`. Keeping one copy is the point:
 * a second "who won" beside the first is how two screens come to disagree.
 */

/**
 * IS THIS CASUAL ROUND ACTUALLY A MATCH — which `shape` cannot tell you.
 *
 * `shape: "match"` is how a casual round is STORED. It was named when the
 * quick round was only ever one person against another, and the word stuck
 * while the screen grew four more formats: stroke play, modified Stableford,
 * four-ball and foursomes. Walked on 2026-09-18: a Stroke Play round was
 * headed "The match", reported "head to head", and ranked under "Holes won".
 * `boardIsStroke` is the round's own basis and is what every board reads.
 */
export function casualIsMatch(state: EventState): boolean {
  return !state.boardIsStroke;
}

export interface CasualStanding {
  /** "Where the match stands" or "Where the round stands". */
  title: string;
  /** What the figures are, beside the title. */
  basis: string;
  /** One singles match, or one match between two sides: "Bea Zed won 2&1". */
  matchLine: string;
  /** A Modified Stableford round, ranked on points. Null otherwise. */
  points: ModStablefordRow[] | null;
  /** Everything else: the ordinary board's rows. */
  rows: StandingRow[];
  isStroke: boolean;
  isStableford: boolean;
  rankedOn: "gross" | "net";
}

export async function casualStanding(state: EventState): Promise<CasualStanding> {
  const isMatchRound = casualIsMatch(state);
  const stage = state.boardStage ?? state.stages[0] ?? null;

  /**
   * A ONE-ON-ONE CASUAL MATCH IS SUMMED UP IN ONE LINE, not a points table
   * (2026-10-04): "Bob won 7&6" where the table said REC 1-0-0 · +7 · PTS 6.5.
   *
   * AND A CASUAL FOUR-BALL TOO (2026-10-04) — two SIDES, one match, the same
   * one line: "Third & Fourth won 6&5". The match row carries the hole-by-hole
   * the cards were derived into, so the line reads the same holes the board
   * does; the sides are named by their own names.
   */
  const oneMatch = (() => {
    if (!isMatchRound) return null;
    const here = state.matches.filter((m) => m.stageId === state.boardStage?.id);
    return here.length === 1 ? here[0] : null;
  })();
  const sideNames =
    oneMatch && !oneMatch.playerAId && oneMatch.teamAId && oneMatch.teamBId
      ? new Map(
          (
            await prisma.team.findMany({
              where: { id: { in: [oneMatch.teamAId, oneMatch.teamBId] }, eventId: state.event.id },
              select: { id: true, name: true },
            })
          ).map((t) => [t.id, t.name]),
        )
      : null;
  const line = (() => {
    if (!oneMatch) return "";
    const singles = !!oneMatch.playerAId && !!oneMatch.playerBId;
    const sides = !!sideNames && sideNames.has(oneMatch.teamAId) && sideNames.has(oneMatch.teamBId);
    if (!singles && !sides) return "";
    const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? "";
    let holes: HoleResult[] = [];
    try {
      holes = JSON.parse(oneMatch.holes) as HoleResult[];
    } catch {
      return "";
    }
    return singles
      ? matchLine({
          aId: oneMatch.playerAId,
          bId: oneMatch.playerBId,
          aName: nameOf(oneMatch.playerAId),
          bName: nameOf(oneMatch.playerBId),
          holes,
          forfeitedBy: oneMatch.forfeitedBy ?? "",
        })
      : matchLine({
          // A team match cannot be forfeited (`forfeitMatch` refuses a side),
          // so the card is the whole answer.
          aId: oneMatch.teamAId,
          bId: oneMatch.teamBId,
          aName: sideNames!.get(oneMatch.teamAId) ?? "",
          bName: sideNames!.get(oneMatch.teamBId) ?? "",
          holes,
        });
  })();

  /**
   * A CASUAL MODIFIED STABLEFORD IS RANKED ON POINTS, here as on the board
   * (2026-10-04). The standard table ranks strokes, so the card said "Nothing
   * to rank here yet" over two finished cards while the leaderboard had them
   * on 20 and 17. Found by the casual-round e2e spec on its first run.
   */
  const points =
    stage && boardKind(stage.format) === "modified-stableford"
      ? await modifiedStablefordBoard(
          state.event.id,
          stage.id,
          state.strokeCourseFor(stage.id).pars,
          state.strokeCourseFor(stage.id).holeDifficulty,
        )
      : null;

  return {
    title: isMatchRound ? "Where the match stands" : "Where the round stands",
    // "Holes won" is a claim about the BASIS, and it was once made for every
    // casual round including the four formats not decided that way.
    basis: isMatchRound ? "Holes won" : points ? "Modified Stableford points" : "Gross, net and to-par",
    matchLine: line,
    points,
    rows: usesStandardBoard(state.boardStage?.format) ? standingRows(state).slice(0, 8) : [],
    isStroke: state.boardIsStroke,
    isStableford: isStablefordRound(state.boardStage?.scoringBasis, state.boardStage?.format),
    rankedOn: state.boardStage?.scoringBasis === "gross" ? "gross" : "net",
  };
}

/**
 * What the money says while it can still change — one sentence, for the
 * round's screen and the money page alike. A gross match is written down as
 * who won each hole, with no card to wait for, so it waits for the match.
 */
export function moneyWaitsFor(state: EventState, nassau = false): string {
  // A Nassau is three bets, and the overall can be won 8&6 with the back
  // nine still being played for — "when the match is over" under "won 8&6"
  // contradicts itself. See `nassauIsDecided`.
  if (nassau) return "Who pays whom shows here when the front, back and overall are all decided.";
  return `Who pays whom shows here when ${casualIsMatch(state) ? "the match is over" : "every card is in"}.`;
}

export interface CasualMoney {
  /** Whether this round has a money game at all. No game, no block. */
  anyGame: boolean;
  /** Every hole is in, so the amounts can no longer change. */
  final: boolean;
  /** "Cat Zed pays Bea Zed $10.00" — the fewest handovers, once final. */
  handovers: string[];
  /**
   * Where each player ends up — "+$16.67", "−$10.00", "square" — once final.
   * The same `standing` the handovers settle, so the two cannot disagree; for
   * the money page, which had the stakes and never the answer.
   */
  positions: Array<{ name: string; text: string }>;
  /** While it is live: what the person looking has riding on it, or "". */
  stake: string;
  /** The round carries a Nassau — see `moneyWaitsFor`. */
  nassau: boolean;
}

/**
 * THE MONEY, ONLY ONCE IT CANNOT CHANGE.
 *
 * `money-layout.ts` opens with the rule — final only, never live — and both
 * readers here already keep it: `roundMoneyFor` says whether there is a game
 * and whether it is final, and `moneyFor`'s handovers come from `gameNets`,
 * which refuses a provisional round at the sink. Nothing here does a sum.
 *
 * While the round is live the one honest money fact is the STAKE — known the
 * moment the bets are agreed, unchanged by any hole — which is what somebody
 * on the first tee wants anyway.
 */
export async function casualMoney(eventId: string, email: string): Promise<CasualMoney> {
  const [round, book, fmt, nassauGames] = await Promise.all([
    roundMoneyFor(eventId, email),
    moneyFor(eventId, email),
    formattingForEvent(eventId),
    prisma.sideGame.findMany({
      where: { eventId, kind: "nassau" },
      select: { kind: true, stageId: true, buyInCents: true, stakeNote: true },
    }),
  ]);
  const write = (cents: number) => money(cents, fmt.currency, fmt.locale);
  /**
   * THE ROUND'S OWN `final`, NOT `anyFinal`. `anyFinal` is "a round is final
   * AND somebody is owed something" — the right question for a screen of
   * winnings, and the wrong one here: a finished skins game where no hole was
   * won outright is final and square, and read through `anyFinal` this screen
   * went on saying "when every card is in" over eighteen holes of every card.
   * Found on the first real walk of this screen, 2026-10-06.
   *
   * And a ROUND fact, so it holds for a host who set the round up for others
   * and is not in it — `rounds[].final` reads the cards, not the viewer.
   */
  const final = round.rounds.length > 0 && round.rounds.every((r) => r.final);
  return {
    anyGame: round.anyGame,
    final,
    handovers: final ? book.transfers.map((t) => `${t.fromName} pays ${t.toName} ${write(t.cents)}`) : [],
    positions: final
      ? book.standing.map((s) => ({
          name: s.name,
          text: s.netCents === 0 ? "square" : `${s.netCents > 0 ? "+" : "−"}${write(Math.abs(s.netCents))}`,
        }))
      : [],
    nassau: nassauStagesIn(nassauGames).size > 0,
    stake:
      round.stake.games > 0
        ? `You have ${write(round.stake.cents)} on ${round.stake.games === 1 ? "1 game" : `${round.stake.games} games`}.`
        : "",
  };
}
