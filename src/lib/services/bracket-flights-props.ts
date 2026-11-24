import { FLIGHT_CRITERIA, proposeShapes } from "@/lib/domain/bracket-flights";
import { indexLabel } from "@/lib/domain/handicap-label";
import { isFinished } from "@/lib/domain/lifecycle-state";
import { isStraightKnockout } from "@/lib/stage-types";
import type { ScopeLock } from "@/lib/domain/tournament-status";
import type { EventState } from "./tournament";

/**
 * WHAT THE FLIGHTS PANEL OF A KNOCKOUT IS HANDED (R9c): ONE reader, so the Bracket page and Tee times & draw cannot offer
 * different criteria, say different reasons or show a different division. `BracketFlights` draws it and sends the
 * organizer's choice back; every figure here is the server's.
 *
 * Which criteria this tournament can use is decided here, where the field is known, and each one that cannot be used says
 * why in the place it would be chosen: "by qualifying score" with no qualifying round, "by your flights" with none made or
 * with somebody in none.
 */
export function bracketFlightsPropsOf(state: EventState, who: { isAdmin: boolean; drawLock: ScopeLock | null }) {
  const straight = isStraightKnockout(state.stages);
  const playerRow = new Map(state.players.map((p) => [p.id, p]));
  const flightless = state.qualifiers.filter((q) => !playerRow.get(q.id)?.groupId).length;
  const criteria = FLIGHT_CRITERIA.map((c) => ({
    ...c,
    unavailable:
      c.key === "qualifying" && straight
        ? "This knockout has no qualifying round before it."
        : c.key === "flights" && state.groups.length === 0
          ? "This tournament has no flights yet. Make them on the Flights screen first."
          : c.key === "flights" && flightless > 0
            ? `${flightless} of the field ${flightless === 1 ? "is" : "are"} in no flight yet.`
            : "",
  }));
  const flights = state.flights
    ? state.flights.plan.brackets.map((b) => ({
        name: b.name,
        size: b.size,
        byes: b.byes,
        rounds: b.rounds,
        players: b.playerIds.map((id) => {
          const row = playerRow.get(id);
          return { id, name: row?.name ?? "A player who has left", index: row ? indexLabel(row) : "" };
        }),
      }))
    : null;
  return {
    fieldSize: state.qualifiers.length,
    criteria,
    shapes: proposeShapes(state.qualifiers.length),
    criterion: state.flights?.plan.criterion ?? null,
    flights,
    unplaced: (state.flights?.unplaced ?? []).map((p) => ({ id: p.id, name: p.name })),
    departed: (state.flights?.departedIds ?? []).map((id) => state.players.find((p) => p.id === id)?.name ?? "A player"),
    lockBy: who.drawLock?.by === "results" || who.drawLock?.by === "completed" ? who.drawLock.by : null,
    readOnly: !who.isAdmin,
    finished: isFinished(state.event.status),
  };
}
