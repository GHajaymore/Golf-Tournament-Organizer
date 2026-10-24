import { describe, it, expect } from "vitest";
import { buildBracket, flightKind, type BracketView } from "@/lib/domain/bracket";
import { planFlights, type FlightEntrant } from "@/lib/domain/bracket-flights";
import { drawsSeeded } from "@/lib/domain/draw-seeding";
import { isByeTie } from "@/lib/domain/bracket-layout";
import type { Player } from "@/lib/domain/types";

/**
 * IN A DRAW MADE BY LOT, THE BYES ARE PLACED BY LOT — AND SPREAD.
 *
 * The golf professional's ruling of 2026-10-23: "in an UNSEEDED (drawn by lot)
 * knockout, byes must not go to 'top seeds' — they are placed by lot, spread
 * evenly through the sheet (both halves, all quarters); only a SEEDED draw gives
 * byes to the top seeds."
 *
 * What the app does, draw method by draw method (read, then held here):
 *
 *   one bracket / two flights   seeded — on handicap, or on qualifying — and the
 *                               byes go to the top seeds, as a seeded draw's should
 *   several flights, by handicap, by your flights or by qualifying score
 *                               seeded the same way inside each flight
 *   several flights, EVENLY AT RANDOM ("Evenly, at random")
 *                               drawn by lot: the order a flight's players are dealt
 *                               in is a shuffle of the tournament's seed, and the
 *                               byes fall on the places the general numerical draw
 *                               leaves empty — which are spread one per quarter
 *                               before any quarter takes a second — so WHO has a bye
 *                               is the lot's, and WHERE is even. Nothing there gave
 *                               the byes to the best players; this pins that it
 *                               cannot start to.
 *   a plate                     filled by who lost, not seeded; it has no byes at all
 *                               (an empty plate place is somebody not yet known)
 *
 * What WAS wrong: a draw by lot printed seed numbers, 1 to n, in the order the
 * lot dealt — so the player dealt first read as a top seed, which is the very
 * thing the ruling says a lot is not. `drawsSeeded` now says no for it.
 */

const entrants = (n: number): FlightEntrant[] =>
  Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}`, name: `Entrant ${String(i + 1).padStart(3, "0")}`, handicapIndex: i * 0.5 }));

const asPlayers = (ids: string[]): Player[] => ids.map((id, i) => ({ id, name: id, handicap: 0, seed: i + 1 }));

/** Each bye's quarter (0–3) and half (0–1) on the sheet, by its first-round place. */
function byePlaces(view: BracketView): { quarter: number; half: number; holder: string }[] {
  const first = view.rounds[0].matches;
  return first
    .filter(isByeTie)
    .map((m) => ({
      quarter: Math.floor((m.matchIndex * 4) / first.length),
      half: Math.floor((m.matchIndex * 2) / first.length),
      holder: (m.a.playerId ?? m.b.playerId)!,
    }));
}

const spread = (counts: number[]) => Math.max(...counts) - Math.min(...counts);

describe("a draw made by lot", () => {
  // Two flights of 22 and 21: each a sheet of 32 with 10 and 11 byes.
  const field = entrants(43);
  const flightsOf = (seed: string) => {
    const plan = planFlights(field, "random", [22, 21], seed);
    if (!plan.ok) throw new Error(plan.error);
    return plan.plan.brackets.map((b, i) => buildBracket(flightKind(i), asPlayers(b.playerIds), {}));
  };

  it("spreads its byes evenly: both halves, every quarter, within one of each other", () => {
    for (const seed of ["club-a", "club-b", "zz-17", "another"]) {
      for (const view of flightsOf(seed)) {
        const places = byePlaces(view);
        expect(places.length).toBeGreaterThan(8);
        const quarters = [0, 1, 2, 3].map((q) => places.filter((p) => p.quarter === q).length);
        const halves = [0, 1].map((h) => places.filter((p) => p.half === h).length);
        expect(spread(quarters), `${seed}: byes by quarter ${quarters}`).toBeLessThanOrEqual(1);
        expect(spread(halves), `${seed}: byes by half ${halves}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("gives the byes by lot, not to the best players — and the same lot every time from the same seed", () => {
    const holders = (seed: string) => flightsOf(seed).flatMap((v) => byePlaces(v).map((p) => p.holder)).sort();
    // Reproducible: the draw an organizer is shown is the draw they get.
    expect(holders("club-a")).toEqual(holders("club-a"));
    // By lot: another seed, other players.
    expect(holders("club-a")).not.toEqual(holders("club-b"));
    // Not the best players: the 21 byes do not go to the 21 lowest handicaps.
    const best = field.slice(0, 21).map((e) => e.id).sort();
    for (const seed of ["club-a", "club-b", "zz-17"]) expect(holders(seed)).not.toEqual(best);
  });

  it("prints no seed numbers, because nobody was seeded", () => {
    const stages = [{ id: "ko", type: "Bracket Stage" }];
    const draws = flightsOf("club-a").map((view) => ({ view }));
    expect(drawsSeeded({ stages, roundsWithResults: new Set(), mode: "flights", criterion: "random", draws })).toEqual([false, false]);
    // The control: the same flights divided by handicap ARE seeded.
    expect(drawsSeeded({ stages, roundsWithResults: new Set(), mode: "flights", criterion: "handicap", draws })).toEqual([true, true]);
  });
});

describe("a seeded draw", () => {
  it("gives its byes to the top seeds — the control on the rule above", () => {
    const view = buildBracket("winners", asPlayers(entrants(22).map((e) => e.id)), {});
    expect(byePlaces(view).map((p) => p.holder).sort()).toEqual(entrants(10).map((e) => e.id).sort());
  });
});
