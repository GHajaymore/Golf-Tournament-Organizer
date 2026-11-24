import "server-only";
import { usesStandardBoard } from "@/lib/formats";
import { flightStandings } from "@/lib/services/me";
import { standingRows, type EventState } from "@/lib/services/tournament";

/**
 * THE FIELD A PRIZE IS AWARDED FROM, in the orders the winner picker opens on (moved out of `prizes/page.tsx` in R8b so
 * that Prizes & side games and Winners & money read ONE answer, never two). The winner picker is drawn on one of them
 * at a time (`moneyPartOf`), and both must offer the same people in the same order.
 *
 * You award a prize by result, so the winner belongs at the top of the list, not wherever the alphabet puts them. This
 * reuses the board's OWN ranking (`standingRows`), so the order agrees with the leaderboard the club is looking at.
 * Everyone unranked, a card that stopped short or nobody in a manual round (where `standingRows` returns `[]`), falls to
 * the bottom in name order, so the picker still lists the whole field and never loses a name.
 *
 * ONLY ON THE ORDINARY BOARD: `standingRows` reads the INDIVIDUAL stroke standing, which is the wrong order for a team,
 * match, skins or Nassau round, so `usesStandardBoard` gates it. Off the standard board the whole field falls back to
 * name order, the right neutral for a prize a side wins.
 */
export interface PrizeFieldEntry {
  id: string;
  name: string;
  place: number | null;
}

export interface PrizeField {
  /** The whole confirmed field, finishing order first. */
  players: PrizeFieldEntry[];
  /** Each flight's own finishing order, only with two or more flights (one flight's order IS the overall order). */
  flights: Array<{ label: string; players: PrizeFieldEntry[] }>;
  /** The field by gross and by net for prizes named for one (2026-10-08); null where the board has no strokes. */
  byScore: { gross: PrizeFieldEntry[] | null; net: PrizeFieldEntry[] | null };
}

export function prizeFieldFor(state: EventState): PrizeField {
  const prizeRank = usesStandardBoard(state.activeStage?.format)
    ? new Map(standingRows(state).filter((r) => r.ranked).map((r) => [r.id, r.rank]))
    : new Map<string, number>();
  const nameById = new Map(state.confirmed.map((p) => [p.id, p.name]));
  const flights =
    state.groups.length > 1
      ? flightStandings(state).map((f) => ({
          label: f.label,
          players: [...f.rows]
            .sort((a, b) => (a.rank > 0 && b.rank > 0 ? a.rank - b.rank : a.rank > 0 ? -1 : b.rank > 0 ? 1 : 0))
            .map((r) => ({ id: r.id, name: nameById.get(r.id) ?? "—", place: r.rank > 0 ? r.rank : null })),
        }))
      : [];
  // Placed as the board places, by the board's own sort and countback on that basis (`strokeStandingsOn`): a tie for Best
  // gross in a net medal is broken on the gross cards' last nine, six, three and one, as a committee breaks it.
  const standings = usesStandardBoard(state.activeStage?.format) && state.boardIsStroke ? state.strokeStandings : [];
  const scoreOrder = (basis: "gross" | "net"): PrizeFieldEntry[] | null => {
    if (standings.length === 0) return null;
    return state.strokeStandingsOn(basis).map((s) => ({ id: s.player.id, name: s.player.name, place: s.ranked ? s.rank : null }));
  };
  const players = [...state.confirmed]
    .map((p) => ({ id: p.id, name: p.name, place: prizeRank.get(p.id) ?? null }))
    .sort((a, b) => {
      if (a.place !== null && b.place !== null) return a.place - b.place;
      if (a.place !== null) return -1;
      if (b.place !== null) return 1;
      return a.name.localeCompare(b.name);
    });
  return { players, flights, byScore: { gross: scoreOrder("gross"), net: scoreOrder("net") } };
}
