import { describe, it, expect } from "vitest";
import {
  bracketFinishOrderAll,
  bracketFinishOrderCombined,
  bracketSizeFor,
  buildBracket,
  flightKind,
  parseBracketDraw,
} from "@/lib/domain/bracket";
import { bracketDraws } from "@/lib/domain/my-tie";
import {
  MOST_FLIGHTS_SUGGESTED,
  flightNames,
  parseFlightPlan,
  planAgainstField,
  planWithPlayerAdded,
  serializeFlightPlan,
  planWithPlayerMoved,
  planFlights,
  proposeShapes,
  planRenamed,
  planReseeded,
  seededOrder,
  topDownCounts,
  type FlightEntrant,
  type FlightPlan,
} from "@/lib/domain/bracket-flights";
import type { Player } from "@/lib/domain/types";

/**
 * A KNOCKOUT IN SEVERAL FLIGHTS — the arithmetic, swept over every field size
 * from one player to two hundred.
 *
 * The rules a divided knockout must keep, each asserted as an INVARIANT over
 * the whole range rather than at one comfortable size (the off-by-ones live at
 * one, two, three, and one more than a power of two):
 *
 *  - everybody is in exactly one bracket, and nobody else is;
 *  - there is no bracket of one;
 *  - a bracket's size is the next power of two at or above its field, so it
 *    has fewer byes than players and no first-round tie is a bye against a bye;
 *  - the byes go to the top seeds — the general numerical draw the Committee
 *    Procedures set out for match play (Section 5F(1)) — which is checked by
 *    handing each flight to `buildBracket`, the one function that draws ties;
 *  - "by handicap" means what it says: nobody in a lower flight has a better
 *    handicap than somebody in a higher one.
 *
 * The fixtures are built so a wrong answer LOOKS different: handicaps are all
 * distinct and deliberately not in entry order, so "took the first sixteen as
 * entered" and "took the sixteen lowest handicaps" cannot coincide.
 */

/** A field whose entry order is NOT its handicap order, with every index distinct. */
function field(n: number): FlightEntrant[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${String(i + 1).padStart(3, "0")}`,
    name: `Player ${String(i + 1).padStart(3, "0")}`,
    // a stride coprime with n + 1 scatters the indexes; + i / 1000 keeps them distinct
    handicapIndex: ((i * 37) % (n + 1)) / 2 + i / 1000,
  }));
}

const SIZES = Array.from({ length: 200 }, (_, i) => i + 1);

function allIds(plan: FlightPlan): string[] {
  return plan.brackets.flatMap((b) => b.playerIds);
}

function asPlayers(ids: string[], byId: Map<string, FlightEntrant>): Player[] {
  return ids.map((id, i) => ({ id, name: byId.get(id)!.name, handicap: byId.get(id)!.handicapIndex ?? 0, seed: i + 1 }));
}

describe("the ways a field can be divided", () => {
  it("offers nothing where there is no knockout to draw", () => {
    for (const n of [0, 1, -3, 2.5, Number.NaN]) expect(proposeShapes(n), `field of ${n}`).toEqual([]);
  });

  it("every shape, at every field size, holds the whole field in brackets that can be played", () => {
    for (const n of SIZES.filter((s) => s >= 2)) {
      const shapes = proposeShapes(n);
      expect(shapes.length, `field of ${n}`).toBeGreaterThan(0);
      expect(shapes[0].counts, `field of ${n}: one bracket is always offered, first`).toEqual([n]);
      expect(shapes.filter((s) => s.recommended).length, `field of ${n}: exactly one is recommended`).toBe(1);
      const seen = new Set<string>();
      for (const s of shapes) {
        const where = `field of ${n}, ${s.label}`;
        expect(seen.has(s.counts.join(",")), `${where}: offered twice`).toBe(false);
        seen.add(s.counts.join(","));
        expect(s.counts.reduce((a, b) => a + b, 0), `${where}: adds up`).toBe(n);
        expect(Math.min(...s.counts), `${where}: a bracket of one`).toBeGreaterThanOrEqual(2);
        let byes = 0;
        for (const c of s.counts) {
          const size = bracketSizeFor(c);
          expect(size - c, `${where}: more byes than players in a bracket of ${c}`).toBeLessThan(c);
          byes += size - c;
        }
        expect(s.byes, `${where}: byes stated`).toBe(byes);
      }
      const best = shapes.find((s) => s.recommended)!;
      expect(best.counts.length, `field of ${n}: recommends ${best.counts.length} brackets`).toBeLessThanOrEqual(MOST_FLIGHTS_SUGGESTED);
      for (const s of shapes.filter((x) => x.counts.length <= MOST_FLIGHTS_SUGGESTED)) {
        expect(best.byes, `field of ${n}: "${s.label}" wastes fewer places than the one recommended`).toBeLessThanOrEqual(s.byes);
      }
    }
  });

  it("a hundred players: three flights of 32 and one of 4, with no place wasted", () => {
    const shapes = proposeShapes(100);
    const by = (counts: number[]) => shapes.find((s) => s.counts.join(",") === counts.join(","));
    expect(by([100])?.byes, "one bracket of 128").toBe(28);
    expect(by([64, 36])?.byes).toBe(28);
    expect(by([32, 32, 32, 4])).toMatchObject({ byes: 0, recommended: true, label: "3 flights of 32 and one of 4" });
    expect(by([16, 16, 16, 16, 16, 16, 4])).toMatchObject({ byes: 0, recommended: false, label: "6 flights of 16 and one of 4" });
    // thirteen brackets waste nothing either, and are offered — never suggested
    expect(by([8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 4])).toMatchObject({ byes: 0, recommended: false });
  });

  it("a field that fills one bracket exactly is one bracket", () => {
    for (const n of [2, 4, 8, 16, 32, 64, 128]) {
      const best = proposeShapes(n).find((s) => s.recommended)!;
      expect(best.counts, `field of ${n}`).toEqual([n]);
      expect(best.byes).toBe(0);
    }
  });

  it("a field too small to flight is offered one bracket and nothing else", () => {
    for (let n = 2; n < 16; n += 1) expect(proposeShapes(n).map((s) => s.counts), `field of ${n}`).toEqual([[n]]);
  });

  it("a remainder of one or two is shared with the flight above, never a flight of its own", () => {
    expect(topDownCounts(17, 16)).toEqual([9, 8]);
    expect(topDownCounts(18, 16)).toEqual([9, 9]);
    expect(topDownCounts(34, 16)).toEqual([16, 9, 9]);
    expect(topDownCounts(33, 8)).toEqual([8, 8, 8, 5, 4]);
    expect(topDownCounts(35, 16), "three left over IS a flight").toEqual([16, 16, 3]);
    expect(topDownCounts(48, 16)).toEqual([16, 16, 16]);
    expect(topDownCounts(5, 16), "smaller than one flight").toEqual([5]);
    expect(topDownCounts(1, 16)).toEqual([]);
  });

  it("names the brackets the way a club writes them on the sheet", () => {
    expect(flightNames(0)).toEqual([]);
    expect(flightNames(1)).toEqual(["Main draw"]);
    expect(flightNames(4)).toEqual(["Championship flight", "First flight", "Second flight", "Third flight"]);
    const many = flightNames(15);
    expect(many[12]).toBe("Twelfth flight");
    expect(many[13], "past the words, a number").toBe("Flight 14");
    expect(new Set(many).size, "every name different").toBe(15);
  });
});

describe("putting the field into brackets", () => {
  it("by handicap, at every size and every shape: everybody once, best players highest, byes to the top seeds", () => {
    for (const n of SIZES.filter((s) => s >= 2)) {
      const entrants = field(n);
      const byId = new Map(entrants.map((e) => [e.id, e]));
      for (const shape of proposeShapes(n)) {
        const where = `field of ${n}, ${shape.label}`;
        const made = planFlights(entrants, "handicap", shape.counts);
        if (!made.ok) throw new Error(`${where}: ${made.error}`);
        const { brackets } = made.plan;
        expect(brackets.map((b) => b.playerIds.length), `${where}: the shape asked for`).toEqual(shape.counts);
        expect([...allIds(made.plan)].sort(), `${where}: everybody once`).toEqual(entrants.map((e) => e.id).sort());

        let worstAbove = -Infinity;
        for (const b of brackets) {
          const hcps = b.playerIds.map((id) => byId.get(id)!.handicapIndex!);
          expect(hcps, `${where}, ${b.name}: seeded best first`).toEqual([...hcps].sort((x, y) => x - y));
          expect(Math.min(...hcps), `${where}, ${b.name}: somebody here is better than somebody in the flight above`).toBeGreaterThan(worstAbove);
          worstAbove = Math.max(...hcps);
          expect(b.size).toBe(bracketSizeFor(b.playerIds.length));
          expect(b.byes).toBe(b.size - b.playerIds.length);
          expect(b.rounds, `${where}, ${b.name}: rounds`).toBe(Math.log2(b.size));

          // drawn by the one function that draws ties
          const view = buildBracket("winners", asPlayers(b.playerIds, byId), {});
          const first = view.rounds[0].matches;
          expect(first.length).toBe(b.size / 2);
          const byeSeeds: number[] = [];
          for (const m of first) {
            expect(m.a.playerId === null && m.b.playerId === null, `${where}, ${b.name}: a bye against a bye`).toBe(false);
            if (m.a.playerId === null) byeSeeds.push(m.b.seed!);
            if (m.b.playerId === null) byeSeeds.push(m.a.seed!);
          }
          expect(byeSeeds.sort((x, y) => x - y), `${where}, ${b.name}: the byes are the top seeds'`).toEqual(Array.from({ length: b.byes }, (_, i) => i + 1));
        }
      }
    }
  });

  it("a player with no handicap is placed after everybody who has one", () => {
    const entrants: FlightEntrant[] = [
      { id: "a", name: "Ada", handicapIndex: null },
      { id: "b", name: "Bea", handicapIndex: 20 },
      { id: "c", name: "Cy", handicapIndex: 3 },
      { id: "d", name: "Dot", handicapIndex: null },
    ];
    const made = planFlights(entrants, "handicap", [2, 2]);
    if (!made.ok) throw new Error(made.error);
    expect(made.plan.brackets.map((b) => b.playerIds)).toEqual([["c", "b"], ["a", "d"]]);
  });

  it("at random: the sizes asked for, everybody once, and the same draw every time for the same seed", () => {
    for (const n of [2, 3, 5, 16, 17, 31, 64, 100]) {
      const entrants = field(n);
      for (const shape of proposeShapes(n)) {
        const first = planFlights(entrants, "random", shape.counts, "draw-1");
        const again = planFlights([...entrants].reverse(), "random", shape.counts, "draw-1");
        if (!first.ok || !again.ok) throw new Error("refused a shape it proposed");
        expect(first.plan.brackets.map((b) => b.playerIds.length), `field of ${n}, ${shape.label}`).toEqual(shape.counts);
        expect([...allIds(first.plan)].sort()).toEqual(entrants.map((e) => e.id).sort());
        expect(again.plan, "the same seed drew differently when the field arrived in another order").toEqual(first.plan);
      }
    }
    // and it IS a shuffle: across seeds the draw moves, and it is not just the handicap order
    const entrants = field(32);
    const draws = ["a", "b", "c", "d", "e"].map((seed) => {
      const made = planFlights(entrants, "random", [16, 16], seed);
      if (!made.ok) throw new Error(made.error);
      return allIds(made.plan).join(",");
    });
    expect(new Set(draws).size, "five seeds gave fewer than five draws").toBe(5);
    const byHandicap = planFlights(entrants, "handicap", [16, 16]);
    if (!byHandicap.ok) throw new Error(byHandicap.error);
    expect(draws).not.toContain(allIds(byHandicap.plan).join(","));
    // a cross-section: neither bracket is the sixteen best
    const best16 = new Set(allIds(byHandicap.plan).slice(0, 16));
    for (const d of draws) {
      const top = d.split(",").slice(0, 16).filter((id) => best16.has(id)).length;
      expect(top, "one bracket took every low handicap").toBeLessThan(16);
    }
  });

  it("a seeded order is a permutation, and the same for the same seed", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const once = seededOrder(items, "seed");
    expect([...once].sort((a, b) => a - b)).toEqual(items);
    expect(seededOrder(items, "seed")).toEqual(once);
    expect(seededOrder(items, "another")).not.toEqual(once);
    expect(items[0], "the list handed in is not rearranged").toBe(0);
  });

  it("by qualifying score: only when everybody has a place, and then best qualifier first", () => {
    const entrants = field(8).map((e, i) => ({ ...e, qualifyingRank: 8 - i }));
    const made = planFlights(entrants, "qualifying", [4, 4]);
    if (!made.ok) throw new Error(made.error);
    expect(made.plan.brackets[0].playerIds).toEqual(["p008", "p007", "p006", "p005"]);
    expect(made.plan.brackets[1].playerIds).toEqual(["p004", "p003", "p002", "p001"]);
    const missing = entrants.map((e, i) => (i === 3 ? { ...e, qualifyingRank: null } : e));
    expect(planFlights(missing, "qualifying", [4, 4])).toMatchObject({ ok: false });
  });

  it("by the tournament's own flights: each flight is a bracket, whatever its size", () => {
    // Twelve, not eleven: at eleven the fixture's stride lands every index in entry order, and a flight
    // left as entered would pass for one seeded by handicap (the last assertion here is that control).
    const entrants = field(12).map((e, i) => ({ ...e, flight: i < 5 ? "Seniors" : i < 9 ? "Ladies" : "Juniors" }));
    const made = planFlights(entrants, "flights", []);
    if (!made.ok) throw new Error(made.error);
    expect(made.plan.brackets.map((b) => [b.name, b.playerIds.length, b.size, b.byes])).toEqual([
      ["Seniors", 5, 8, 3],
      ["Ladies", 4, 4, 0],
      ["Juniors", 3, 4, 1],
    ]);
    expect([...allIds(made.plan)].sort()).toEqual(entrants.map((e) => e.id).sort());
    // Inside each flight the best handicap is the top seed — the byes in the Seniors' bracket of
    // eight are theirs — and NOT whoever happened to enter first (the field is not in handicap order).
    const index = new Map(entrants.map((e) => [e.id, e.handicapIndex!]));
    for (const b of made.plan.brackets) {
      const seeded = b.playerIds.map((id) => index.get(id)!);
      expect(seeded, `${b.name} is not seeded by handicap`).toEqual([...seeded].sort((x, y) => x - y));
    }
    const seniorsAsEntered = entrants.slice(0, 5).map((e) => e.id);
    expect(made.plan.brackets[0].playerIds, "the fixture cannot tell seeding from entry order").not.toEqual(seniorsAsEntered);
  });

  it("refuses, in words an organizer can act on, what cannot be drawn", () => {
    const entrants = field(10);
    const refused = (r: ReturnType<typeof planFlights>) => (r.ok ? "DRAWN" : r.error);
    expect(refused(planFlights(entrants, "handicap", [5, 4])), "nine places for ten players").toMatch(/hold 9 and the field is 10/);
    expect(refused(planFlights(entrants, "handicap", [9, 1]))).toMatch(/bracket of one/);
    expect(refused(planFlights(entrants, "handicap", []))).toMatch(/how many players/);
    expect(refused(planFlights(entrants.slice(0, 1), "handicap", [1]))).toMatch(/at least two/);
    expect(refused(planFlights([...entrants, entrants[0]], "handicap", [6, 5]))).toMatch(/twice/);
    expect(refused(planFlights(entrants, "flights", [])), "no flights at all").toMatch(/no flights/);
    const some = entrants.map((e, i) => ({ ...e, flight: i < 6 ? "A" : "" }));
    expect(refused(planFlights(some, "flights", []))).toMatch(/4 of the field are in no flight/);
    const lonely = entrants.map((e, i) => ({ ...e, flight: i === 0 ? "Solo" : "Rest" }));
    expect(refused(planFlights(lonely, "flights", []))).toMatch(/Solo has one player/);
  });
});

describe("the organizer's own adjustments", () => {
  const entrants = field(20);
  const start = (() => {
    const made = planFlights(entrants, "handicap", [16, 4]);
    if (!made.ok) throw new Error(made.error);
    return made.plan;
  })();

  it("moving a player resizes both brackets and says what it costs", () => {
    const mover = start.brackets[1].playerIds[0];
    const moved = planWithPlayerMoved(start, mover, 0);
    if (!moved.ok) throw new Error(moved.error);
    const [top, next] = moved.plan.brackets;
    expect(top.playerIds.length).toBe(17);
    expect(top.playerIds[16], "they join at the foot: the seeding above them was earned").toBe(mover);
    expect([top.size, top.byes, top.rounds], "seventeen is a bracket of 32").toEqual([32, 15, 5]);
    expect([next.playerIds.length, next.size, next.byes]).toEqual([3, 4, 1]);
    expect([...allIds(moved.plan)].sort(), "nobody lost, nobody twice").toEqual(entrants.map((e) => e.id).sort());
    expect(start.brackets[0].playerIds.length, "the plan handed in is not changed").toBe(16);
  });

  it("will not leave a bracket with one player, and treats a move to the same bracket as no move", () => {
    const pair = planFlights(field(4), "handicap", [2, 2]);
    if (!pair.ok) throw new Error(pair.error);
    expect(planWithPlayerMoved(pair.plan, pair.plan.brackets[1].playerIds[0], 0)).toMatchObject({ ok: false });
    expect(planWithPlayerMoved(start, start.brackets[0].playerIds[3], 0)).toEqual({ ok: true, plan: start });
    expect(planWithPlayerMoved(start, "nobody", 0)).toMatchObject({ ok: false });
    expect(planWithPlayerMoved(start, start.brackets[0].playerIds[0], 5)).toMatchObject({ ok: false });
  });

  it("a seeding by hand lists the same players, each once", () => {
    const ids = start.brackets[1].playerIds;
    const flipped = planReseeded(start, 1, [...ids].reverse());
    if (!flipped.ok) throw new Error(flipped.error);
    expect(flipped.plan.brackets[1].playerIds).toEqual([...ids].reverse());
    expect(flipped.plan.brackets[0], "the other bracket is untouched").toBe(start.brackets[0]);
    expect(planReseeded(start, 1, ids.slice(1)), "one dropped").toMatchObject({ ok: false });
    expect(planReseeded(start, 1, [ids[0], ids[0], ids[1], ids[2]]), "one twice").toMatchObject({ ok: false });
    expect(planReseeded(start, 1, [...ids.slice(0, 3), start.brackets[0].playerIds[0]]), "one swapped for somebody from another bracket").toMatchObject({ ok: false });
    // Everybody who belongs is listed, once — and so is somebody who does not. The other three
    // checks pass this; only the count catches it, and a reseed would have put a player in two flights.
    expect(planReseeded(start, 1, [...ids, start.brackets[0].playerIds[0]]), "one ADDED from another bracket").toMatchObject({ ok: false });
    expect(planReseeded(start, 9, ids)).toMatchObject({ ok: false });
    // A flight STORED with somebody in it twice (a plan is never tidied on the way in). A list as
    // long as the flight, naming everybody in it, can still turn "a, a, b" into "a, b, b".
    const doubled = parseFlightPlan(JSON.stringify({ v: 2, criterion: "handicap", flights: [{ name: "Only", playerIds: ["a", "a", "b"] }] }))!;
    expect(planReseeded(doubled, 0, ["a", "b", "b"]), "a reseed changed who is in a doubled flight").toMatchObject({ ok: false });
  });

  it("a bracket can be renamed to the club's own word, once", () => {
    const named = planRenamed(start, 0, "  Scratch  ");
    if (!named.ok) throw new Error(named.error);
    expect(named.plan.brackets.map((b) => b.name)).toEqual(["Scratch", "First flight"]);
    expect(planRenamed(start, 0, "   ")).toMatchObject({ ok: false });
    expect(planRenamed(start, 0, "first FLIGHT"), "two brackets, one name").toMatchObject({ ok: false });
    expect(planRenamed(start, 4, "X")).toMatchObject({ ok: false });
  });
});

describe("the plan as the tournament keeps it", () => {
  const entrants = field(21);
  const made = planFlights(entrants, "handicap", [16, 5]);
  if (!made.ok) throw new Error(made.error);
  const plan = made.plan;

  it("comes back as it went in: the same people, in the same flights, in the same order, under the same names", () => {
    const named = planRenamed(plan, 1, "Seniors");
    if (!named.ok) throw new Error(named.error);
    const back = parseFlightPlan(serializeFlightPlan(named.plan));
    expect(back).toEqual(named.plan);
    expect(back!.brackets.map((b) => [b.name, b.size, b.byes, b.rounds])).toEqual([
      ["Championship flight", 16, 0, 4],
      ["Seniors", 8, 3, 3],
    ]);
    // HOW it was divided comes back too: the screen offers "Draw again" only for a random division,
    // and says which way the field was divided over every flight.
    for (const criterion of ["handicap", "random", "flights", "qualifying"] as const) {
      expect(parseFlightPlan(serializeFlightPlan({ ...plan, criterion }))?.criterion).toBe(criterion);
    }
  });

  it("is not mistaken for one bracket's flat draw, nor a flat draw for a plan", () => {
    const stored = serializeFlightPlan(plan);
    expect(parseBracketDraw(stored), "the one-bracket reader took a division for a draw").toBeNull();
    expect(parseFlightPlan(JSON.stringify(entrants.map((e) => e.id))), "the flights reader took a flat list for a division").toBeNull();
  });

  it("reads nothing rather than half of something", () => {
    const good = JSON.parse(serializeFlightPlan(plan)) as { v: number; criterion: string; flights: { name: string; playerIds: unknown[] }[] };
    const broken = (change: (p: typeof good) => void) => {
      const copy = JSON.parse(JSON.stringify(good)) as typeof good;
      change(copy);
      return parseFlightPlan(JSON.stringify(copy));
    };
    expect(parseFlightPlan("")).toBeNull();
    expect(parseFlightPlan(null)).toBeNull();
    expect(parseFlightPlan("{not json")).toBeNull();
    expect(broken((p) => { p.v = 1; }), "another version").toBeNull();
    expect(broken((p) => { p.criterion = "alphabetical"; }), "a criterion the app does not have").toBeNull();
    expect(broken((p) => { p.flights = []; }), "no flights").toBeNull();
    expect(broken((p) => { p.flights[1].name = "  "; }), "a flight nobody can name").toBeNull();
    expect(broken((p) => { p.flights[1].playerIds = [p.flights[1].playerIds[0]]; }), "a flight of one").toBeNull();
    expect(broken((p) => { p.flights[0].playerIds[3] = 7; }), "something that is not a player in a flight").toBeNull();
    // and the plan it was made from still reads
    expect(parseFlightPlan(JSON.stringify(good))).not.toBeNull();
  });

  it("a player listed twice stays twice: a stored draw is never tidied", () => {
    const raw = JSON.parse(serializeFlightPlan(plan)) as { flights: { playerIds: string[] }[] };
    raw.flights[1].playerIds.push(raw.flights[0].playerIds[0]);
    const back = parseFlightPlan(JSON.stringify(raw))!;
    expect(back.brackets[1].playerIds.length).toBe(6);
    expect(back.brackets[0].playerIds[0]).toBe(back.brackets[1].playerIds[5]);
  });

  it("is held against today's field: who has entered since, and who has left", () => {
    const today = [...entrants.slice(2).map((e) => e.id), "late-1", "late-2"];
    const { unplaced, departed } = planAgainstField(plan, today);
    expect(unplaced, "entered after the division").toEqual(["late-1", "late-2"]);
    expect(departed.sort(), "in a flight, no longer in the field").toEqual([entrants[0].id, entrants[1].id].sort());
    expect(planAgainstField(plan, entrants.map((e) => e.id))).toEqual({ unplaced: [], departed: [] });
  });

  it("a late entrant goes in at the foot of the flight chosen, and only once", () => {
    const added = planWithPlayerAdded(plan, "late-1", 1);
    if (!added.ok) throw new Error(added.error);
    expect(added.plan.brackets[1].playerIds.at(-1)).toBe("late-1");
    expect([added.plan.brackets[1].playerIds.length, added.plan.brackets[1].size, added.plan.brackets[1].byes]).toEqual([6, 8, 2]);
    expect(added.plan.brackets[0], "the other flight is untouched").toBe(plan.brackets[0]);
    expect(planWithPlayerAdded(added.plan, "late-1", 0), "already in the draw").toMatchObject({ ok: false });
    expect(planWithPlayerAdded(plan, "late-1", 2), "no such flight").toMatchObject({ ok: false });
  });
});

describe("several flights, drawn and finished", () => {
  const entrants = field(21);
  const byId = new Map(entrants.map((e) => [e.id, e]));
  const made = planFlights(entrants, "handicap", [8, 8, 5]);
  if (!made.ok) throw new Error(made.error);
  const plan = made.plan;

  /** Play a flight out: the higher seed wins every tie. Returns the stored winners. */
  function playOut(index: number, winners: Record<string, string>): void {
    const players = asPlayers(plan.brackets[index].playerIds, byId);
    for (let guard = 0; guard < 8; guard += 1) {
      const view = buildBracket(flightKind(index), players, winners);
      const open = view.rounds.flatMap((r) => r.matches).filter((m) => !m.winnerId && m.a.playerId && m.b.playerId);
      if (open.length === 0) return;
      for (const m of open) winners[m.key] = (m.a.seed ?? 99) < (m.b.seed ?? 99) ? m.a.playerId! : m.b.playerId!;
    }
  }

  it("each flight's ties are filed under its own word, the first two being the words two flights have always used", () => {
    expect([0, 1, 2, 3, 11].map(flightKind)).toEqual(["winners", "consolation", "flight3", "flight4", "flight12"]);
    const keys = plan.brackets.map((b, i) => buildBracket(flightKind(i), asPlayers(b.playerIds, byId), {}).rounds[0].matches[0].key);
    expect(keys).toEqual(["winners-0-0", "consolation-0-0", "flight3-0-0"]);
    // no key of one flight is a key of another
    const all = plan.brackets.flatMap((b, i) => buildBracket(flightKind(i), asPlayers(b.playerIds, byId), {}).rounds.flatMap((r) => r.matches.map((m) => m.key)));
    expect(new Set(all).size).toBe(all.length);
  });

  it("a result recorded in one flight moves nobody in another", () => {
    const winners: Record<string, string> = {};
    playOut(2, winners);
    const top = buildBracket(flightKind(0), asPlayers(plan.brackets[0].playerIds, byId), winners);
    expect(top.rounds.flatMap((r) => r.matches).some((m) => m.winnerId), "the Championship flight has a result it never played").toBe(false);
    const third = buildBracket(flightKind(2), asPlayers(plan.brackets[2].playerIds, byId), winners);
    expect(third.champion?.playerId, "the flight that was played has its champion").toBe(plan.brackets[2].playerIds[0]);
  });

  it("finishing order runs flight by flight: nobody in a lower flight is placed above anybody in a higher one", () => {
    const winners: Record<string, string> = {};
    for (let i = 0; i < plan.brackets.length; i += 1) playOut(i, winners);
    const views = plan.brackets.map((b, i) => buildBracket(flightKind(i), asPlayers(b.playerIds, byId), winners));
    const order = bracketFinishOrderAll(views);
    expect(order.length, "everybody is placed").toBe(21);
    expect(new Set(order.map((p) => p.playerId)).size, "nobody twice").toBe(21);
    const flightOf = new Map(plan.brackets.flatMap((b, i) => b.playerIds.map((id) => [id, i] as const)));
    const worstRankIn = (i: number) => Math.max(...order.filter((p) => flightOf.get(p.playerId) === i).map((p) => p.rank));
    const bestRankIn = (i: number) => Math.min(...order.filter((p) => flightOf.get(p.playerId) === i).map((p) => p.rank));
    expect(bestRankIn(0)).toBe(1);
    expect(bestRankIn(1), "the First flight starts below everybody the Championship flight placed").toBe(9);
    expect(bestRankIn(2)).toBe(17);
    expect(worstRankIn(0)).toBeLessThan(bestRankIn(1));
    expect(worstRankIn(1)).toBeLessThan(bestRankIn(2));
    // the champion of each flight heads it
    expect(order.find((p) => p.rank === 1)?.playerId).toBe(plan.brackets[0].playerIds[0]);
    expect(order.find((p) => p.rank === 9)?.playerId).toBe(plan.brackets[1].playerIds[0]);
  });

  it("a flight still being played places nobody, and a place once given never moves when it finishes", () => {
    const winners: Record<string, string> = {};
    playOut(0, winners);
    playOut(2, winners);
    const viewsNow = () => plan.brackets.map((b, i) => buildBracket(flightKind(i), asPlayers(b.playerIds, byId), winners));
    const before = bracketFinishOrderAll(viewsNow());
    const flightOf = new Map(plan.brackets.flatMap((b, i) => b.playerIds.map((id) => [id, i] as const)));
    expect(before.filter((p) => flightOf.get(p.playerId) === 1), "the First flight has no result and nobody in it is ranked").toEqual([]);
    expect(before.length).toBe(8 + 5);
    // The Second flight's winner is 17th: below the eight of the Championship flight and the eight
    // of the First, whether or not the First flight has finished. Counted from the players already
    // PLACED, they read 9th here and dropped to 17th when the First flight came in.
    expect(Math.min(...before.filter((p) => flightOf.get(p.playerId) === 2).map((p) => p.rank))).toBe(17);

    playOut(1, winners);
    const after = bracketFinishOrderAll(viewsNow());
    expect(after.length).toBe(21);
    const rankAfter = new Map(after.map((p) => [p.playerId, p.rank]));
    for (const p of before) expect(rankAfter.get(p.playerId), `${p.name} was ${p.rank} and moved when another flight finished`).toBe(p.rank);
    expect(new Set(after.map((p) => `${flightOf.get(p.playerId)}:${p.rank}`)).size, "no two flights share a place").toBe(
      new Set(after.map((p) => p.rank)).size,
    );
  });

  it("with the top flight still being played there is no order at all, however many flights below it are finished", () => {
    expect(bracketFinishOrderAll(plan.brackets.map((b, i) => buildBracket(flightKind(i), asPlayers(b.playerIds, byId), {})))).toEqual([]);
    expect(bracketFinishOrderAll([])).toEqual([]);
    // Both lower flights played out, the Championship flight not: there is no winner to head a
    // list, and a list that began at 9th would be read as one that had lost its first eight.
    const winners: Record<string, string> = {};
    playOut(1, winners);
    playOut(2, winners);
    const views = plan.brackets.map((b, i) => buildBracket(flightKind(i), asPlayers(b.playerIds, byId), winners));
    expect(views[1].champion, "the fixture did not finish the First flight").not.toBeNull();
    expect(bracketFinishOrderAll(views)).toEqual([]);
  });

  it("the two-draw rule is the same rule: split and plate finish exactly as they did", () => {
    const winners: Record<string, string> = {};
    playOut(0, winners);
    playOut(1, winners);
    const a = buildBracket("winners", asPlayers(plan.brackets[0].playerIds, byId), winners);
    const b = buildBracket("consolation", asPlayers(plan.brackets[1].playerIds, byId), winners);
    expect(bracketFinishOrderCombined(a, b)).toEqual(bracketFinishOrderAll([a, b]));
    // a plate's field is the main draw's own losers: already placed, so it adds nobody
    expect(bracketFinishOrderAll([a, a]).length).toBe(8);
  });

  it("the list of an event's draws is every flight where there are flights, and what it always was otherwise", () => {
    const views = plan.brackets.map((b, i) => ({ label: b.name, view: buildBracket(flightKind(i), asPlayers(b.playerIds, byId), {}) }));
    const inFlights = bracketDraws({ winners: views[0].view, consolation: views[1].view, mainLabel: views[0].label, secondLabel: views[1].label, draws: views });
    expect(inFlights.map((d) => d.label)).toEqual(["Championship flight", "First flight", "Second flight"]);
    expect(bracketDraws({ winners: views[0].view, consolation: views[1].view, mainLabel: "Main draw", secondLabel: "" }).length, "one bracket").toBe(1);
    expect(bracketDraws({ winners: views[0].view, consolation: views[1].view, mainLabel: "Flight A", secondLabel: "Flight B" }).map((d) => d.label)).toEqual(["Flight A", "Flight B"]);
    expect(bracketDraws({ winners: views[0].view, consolation: views[1].view, secondLabel: "", draws: [] }).length, "an empty list is no list").toBe(1);
  });
});
