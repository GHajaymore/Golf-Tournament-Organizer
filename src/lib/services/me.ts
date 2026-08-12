import { prisma } from "@/lib/db";
import { needsTeams } from "@/lib/formats";
import { generatesPairings } from "@/lib/stage-types";
import { parseTeeSheet } from "@/lib/domain/tee-sheet";
import { standingRows, type EventState } from "@/lib/services/tournament";
import { filledHoles } from "@/lib/domain/card-approval";

/**
 * Everything the player-facing screens need about *this* person, in one place.
 *
 * The player shell asks a different question from the console. The console
 * asks "what is the state of the tournament"; a player asks "where am I, who
 * am I with, and what do I owe". Those are answerable from data the app
 * already holds, but they were scattered — and `ownPlayerIds`, the bit that
 * decides which rows are yours at all, existed privately in two action files
 * with no shared definition.
 *
 * Gathering it here is a correctness decision as much as a tidiness one: if
 * the screen resolves "me" differently from the action that writes my card,
 * the app will show one person's round and save another's.
 */

/** The Player rows this signed-in person is, in this event — matched by email. */
export async function myPlayerIds(eventId: string, email: string): Promise<Set<string>> {
  const rows = await prisma.player.findMany({
    // Case-insensitive: an address typed into a roster import is not
    // necessarily cased the way the same person typed it when signing up.
    where: { eventId, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

export interface MyRound {
  stageId: string;
  label: string;
  holes: number;
  /**
   * Whether this round is scored on a card that is mine alone.
   *
   * False for match play (scored against an opponent) and for team formats
   * (scored on the side's card). Decided here rather than on each screen so
   * Today cannot offer a card that My card then refuses to show — the two
   * would be reading the same round and disagreeing about it.
   */
  ownCard: boolean;
  /** The tee group I am in, if a sheet has been drawn. */
  group: { name: string; time: string; startHole: number; partners: string[] } | null;
  /** My card for this round: the strokes themselves, how far round I am, and
   *  where it has got to. The strokes are returned, not just the count,
   *  because the entry screen has to open on what is already there — a card
   *  that opens blank and then saves is a card that erases a round. */
  card: { strokes: (number | null)[]; filled: number; status: string } | null;
}

export interface Me {
  playerId: string | null;
  name: string;
  /** My row in the standings — position and score, from the same engine the
   *  leaderboard uses rather than a second calculation. */
  standing: { rank: number; toPar: number; thru: number; points: number } | null;
  round: MyRound | null;
}

/**
 * Resolve the signed-in player's own view of the current round.
 *
 * Returns `playerId: null` for someone with no Player row in this event — an
 * organizer who does not play, most often. The caller decides what to show;
 * this does not invent a player.
 */
export async function meFor(state: EventState, email: string): Promise<Me> {
  const ids = await myPlayerIds(state.event.id, email);
  const playerId = [...ids][0] ?? null;
  const player = playerId ? state.confirmed.find((p) => p.id === playerId) ?? null : null;

  const stage = state.activeStage ?? state.stages[0] ?? null;
  if (!playerId || !stage) {
    return { playerId, name: player?.name ?? "", standing: null, round: null };
  }

  const holes = stage.holes === 9 ? 9 : 18;

  // Who I am playing with. Names come from the field rather than the sheet, so
  // a player withdrawn after the draw simply drops out instead of appearing.
  const sheet = parseTeeSheet(stage.teeSheet);
  const mine = sheet?.groups.find((g) => g.playerIds.includes(playerId)) ?? null;
  const group = mine
    ? {
        name: mine.name,
        time: mine.time,
        startHole: mine.startHole,
        partners: mine.playerIds
          .filter((id) => id !== playerId)
          .map((id) => state.confirmed.find((p) => p.id === id)?.name)
          .filter((n): n is string => !!n),
      }
    : null;

  const row = await prisma.scorecard.findFirst({
    where: { eventId: state.event.id, stageId: stage.id, playerId },
    select: { strokes: true, status: true },
  });
  let card: MyRound["card"] = null;
  if (row) {
    let strokes: (number | null)[] = [];
    try {
      strokes = JSON.parse(row.strokes) as (number | null)[];
    } catch {
      // Unreadable strokes are treated as an empty card rather than throwing:
      // a player should still be able to open the screen and re-enter the
      // round. The count below then honestly reports 0 of 18.
      strokes = [];
    }
    // Normalised to the round's length so the entry grid and the saved array
    // always agree — a 9-hole round must not be handed an 18-slot card.
    const sized: (number | null)[] = Array.from({ length: holes }, (_, i) => strokes[i] ?? null);
    card = { strokes: sized, filled: filledHoles(sized, holes), status: row.status };
  }

  // Position from the same standingRows the leaderboard renders — never a
  // second calculation, which is how two screens come to disagree about who
  // is winning.
  const standing = standingRows(state).find((r) => r.id === playerId) ?? null;

  return {
    playerId,
    name: player?.name ?? "",
    standing: standing
      ? { rank: standing.rank, toPar: standing.toPar, thru: standing.thru, points: standing.points }
      : null,
    round: {
      stageId: stage.id,
      label: stage.description?.trim() || stage.type || "This round",
      holes,
      // A match is scored against an opponent and a team round on the side's
      // card; neither is a card this player owns or can return alone.
      ownCard: !needsTeams(stage.format) && !generatesPairings(stage.type),
      group,
      card,
    },
  };
}
