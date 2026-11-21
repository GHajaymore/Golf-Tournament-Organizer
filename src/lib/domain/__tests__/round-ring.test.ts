import { describe, it, expect } from "vitest";
import { tournamentStatus, type RoundNeedKey, type StatusRound, type TournamentFacts } from "../tournament-status";
import { roundRing, roundRingWords } from "../round-ring";
import { FAMILY_FIXTURES, FAMILIES, facts, round, launched, completed } from "./tournament-facts-fixtures";

/**
 * THE NEEDS RING, WORKED FROM THE MACHINE'S OWN FACTS (R1b, ruling 15 Nov).
 *
 * The ring is "settings made of settings asked" for course, format and date. Three invariants
 * hold for every round of every family, as set up, launched and completed; the CONVERSE ("every
 * round full, so the Rounds step is done") is NOT asserted, because it is not true: the step's
 * `done` reads every round while needs are raised for playing rounds only (ruling §2).
 */

const s = tournamentStatus;
const RING: RoundNeedKey[] = ["course", "card", "format", "date"];
const slot = (k: RoundNeedKey) => (k === "card" ? "course" : k);

/** Each fixture as the organizer might have left it: as set up, no card, unscorable, undated. */
const VARIANTS: Record<string, (f: TournamentFacts) => TournamentFacts> = {
  "as set up": (f) => f,
  "no course card on the first round": (f) => {
    const r = f.rounds.find((x) => x.playing)!;
    return { ...f, missingCards: [{ stageId: r.id, label: r.label, course: "" }] };
  },
  "a course with no card": (f) => {
    const r = f.rounds.find((x) => x.playing)!;
    return { ...f, missingCards: [{ stageId: r.id, label: r.label, course: "Invented Links" }] };
  },
  "a format its type cannot score": (f) => ({ ...f, rounds: f.rounds.map((r, i) => (i === 0 ? { ...r, scorable: false } : r)) }),
  "no round dated": (f) => ({ ...f, rounds: f.rounds.map((r) => ({ ...r, scheduled: false })) }),
  "no flights made": (f) => ({ ...f, groups: 0 }),
};

const STATES: Record<string, (f: TournamentFacts) => TournamentFacts> = {
  "set up": (f) => f,
  launched: launched,
  completed: completed,
};

/**
 * WHERE THE RULE "A GAP MEANS THE ROUNDS STEP IS NOT DONE" DOES NOT HOLD (found in R1b, reported):
 * a LAUNCHED league whose next week has no day. The Rounds step's `done` for a league is
 * `!holdsNow` and nothing holds once play has begun, so the step is ticked while the ring is 2 of 3
 * (the live dashboard raises it as the next action, "Set Week N's day"). The ring is drawn only on a
 * set-up round's head, so no screen shows the two together; if one ever does, this entry is the reason.
 */
const KNOWN_EXCEPTIONS: readonly string[] = ["league/no round dated/launched"];
const isKnownException = (key: string) => KNOWN_EXCEPTIONS.includes(key);

describe("the needs ring, for every round of every family", () => {
  const excepted: string[] = [];
  let rounds = 0;
  let gaps = 0;
  for (const family of FAMILIES) {
    for (const [variant, vary] of Object.entries(VARIANTS)) {
      for (const [state, move] of Object.entries(STATES)) {
        it(`${family}, ${variant}, ${state}`, () => {
          const st = s(move(vary(FAMILY_FIXTURES[family]())));
          const stages = st.setup.steps.find((x) => x.key === "stages");
          for (const r of st.rounds) {
            rounds++;
            // Each ring-slot need has its slot asked.
            for (const n of r.needs.filter((x) => RING.includes(x.key))) {
              expect(r.asked, `${r.label}: ${n.key} is needed but not asked`).toContain(slot(n.key));
            }
            // Never the Tee times stop's.
            expect(r.asked).not.toContain("draw");
            expect(r.asked).not.toContain("teeSheet");
            const ring = roundRing(r);
            if (ring === null) continue;
            expect(ring.set).toBeGreaterThanOrEqual(0);
            expect(ring.set).toBeLessThanOrEqual(ring.of);
            // A gap means the Rounds step is not done.
            if (ring.set < ring.of && stages) {
              gaps++;
              if (isKnownException(`${family}/${variant}/${state}`)) {
                // Recorded, not bent: see KNOWN_EXCEPTIONS. It must still be true, or the entry is stale.
                excepted.push(`${family}/${variant}/${state}`);
                expect(stages.done).toBe(true);
                continue;
              }
              expect(stages.done, `${family}/${variant}/${state}: ${r.label} has a gap and the step is ticked`).toBe(false);
            }
            // Holding means launch is refused and the Rounds step holds.
            if (ring.holds) {
              expect(st.refusals.launch, `${r.label} holds and launch is not refused`).not.toBeNull();
              expect(stages?.holds, `${r.label} holds and the Rounds step does not`).toBe(true);
            }
          }
        });
      }
    }
  }
  it("CONTROL: the sweep reached rounds, and some had a gap", () => {
    expect(rounds).toBeGreaterThan(100);
    expect(gaps).toBeGreaterThan(10);
    expect([...new Set(excepted)]).toEqual(KNOWN_EXCEPTIONS);
  });
});

describe("the needs ring, worked by hand", () => {
  const ringOf = (f: TournamentFacts, id: string) => roundRing(s(f).rounds.find((r) => r.id === id)!);

  it("a one-round medal asks two things (its day is its dates) and has both", () => {
    expect(ringOf(FAMILY_FIXTURES.stroke(), "r1")).toEqual({ set: 2, of: 2, holds: false });
  });

  it("a two-round championship with no course and no date on round 2 is 1 of 3", () => {
    const f = facts({
      rounds: [round({ id: "r1", position: 0 }), round({ id: "r2", position: 1, scheduled: false })],
      missingCards: [{ stageId: "r2", label: "Round 2", course: "" }],
    });
    expect(ringOf(f, "r1")).toEqual({ set: 3, of: 3, holds: false });
    const two = ringOf(f, "r2")!;
    expect(two).toEqual({ set: 1, of: 3, holds: true });
    expect(roundRingWords(two)).toBe("1 of 3 set");
  });

  it("a league's next week undated is 2 of 3 and holds; a later undated week asks only two and is silent", () => {
    const f = FAMILY_FIXTURES.league();
    f.rounds = f.rounds.map((r) => ({ ...r, scheduled: false }));
    expect(ringOf(f, "w1")).toEqual({ set: 2, of: 3, holds: true });
    expect(ringOf(f, "w2")).toEqual({ set: 2, of: 2, holds: false });
  });

  it("a cut-fed round 2 before launch has no draw slot", () => {
    const f = facts({
      rounds: [
        round({ id: "r1", position: 0 }),
        round({ id: "r2", position: 1, drawsPairings: true, cutFed: true, teeSheetSaved: null }),
      ],
    });
    const st = s(f).rounds[1];
    expect(st.asked).toEqual(["course", "format", "date"]);
    expect(st.needs.map((n) => n.key)).not.toContain("draw");
    expect(roundRing(st)).toEqual({ set: 3, of: 3, holds: false });
  });

  it("a round robin with no pairings is not a gap in the ring: the draw is the Tee times stop's", () => {
    const f = { ...FAMILY_FIXTURES.roundRobinFlights(), groups: 0 };
    f.rounds = f.rounds.map((r) => ({ ...r, matches: 0 }));
    const r = s(f).rounds[0];
    expect(r.needs.map((n) => n.key)).toContain("draw");
    expect(roundRing(r)).toEqual({ set: 2, of: 2, holds: false });
  });

  it("a closed round and a played round have no ring", () => {
    const done = s(completed(FAMILY_FIXTURES.stroke())).rounds[0];
    expect(done.asked).toEqual([]);
    expect(roundRing(done)).toBeNull();
    const played: StatusRound = { id: "x", label: "Round 1", state: "under-way", needs: [], asked: ["course", "format"] };
    expect(roundRing(played)).toBeNull();
  });

  it("a round asked nothing has no ring", () => {
    expect(roundRing({ id: "x", label: "Round 1", state: "not-started", needs: [], asked: [] })).toBeNull();
  });
});
