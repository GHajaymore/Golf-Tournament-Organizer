import { describe, it, expect } from "vitest";
import { fieldFactsOf, fieldLockSaid } from "../field-change";
import { scopeLockOf, tournamentStatus, type Family, type ScopeLock, type TournamentFacts } from "../tournament-status";
import { FAMILIES, FAMILY_FIXTURES, launched } from "./tournament-facts-fixtures";
import { NO_SHEET } from "../../__tests__/field-doors";

/**
 * THE FIELD'S LOCK SAYS WHAT IS REALLY LOCKED (J13 finding 1, UX Writer).
 *
 * After launch the machine locks the field by launch, and its reason read
 * "Locked because the tournament is live." — beside a late entry the day-of
 * rule still takes. The words below are written by hand from what the desk
 * does on the morning (a late entry is taken where flights are a prize
 * division or a league runs; a round robin takes one with a flight; nowhere
 * the draw IS the field), never imported from the app.
 */

const LIVE = "Locked because the tournament is live.";
const OPEN = "Players’ details and imports are locked because the tournament is live. A late entry can still be added here.";
const OPEN_WITH_FLIGHT = "Players’ details and imports are locked because the tournament is live. A late entry can still be added here, with a flight.";
const DONE = "Locked because the tournament is completed.";

type Stage = "live" | "liveWithResult" | "completed";

function at(family: Family, stage: Stage): TournamentFacts {
  const f = launched(FAMILY_FIXTURES[family]());
  const withResult = { ...f, rounds: f.rounds.map((r, i) => (i === 0 ? { ...r, hasResult: true } : r)) };
  if (stage === "live") return f;
  if (stage === "liveWithResult") return withResult;
  return { ...withResult, status: "completed", configUnlocked: false };
}

function said(family: Family, stage: Stage): ScopeLock {
  const facts = at(family, stage);
  const lock = scopeLockOf(tournamentStatus(facts).locks, "field");
  if (!lock) throw new Error(`${family} ${stage}: the field is not locked`);
  return fieldLockSaid(fieldFactsOf(facts, NO_SHEET), lock);
}

/** The words, worked by hand: [family, stage] → sentence. */
const EXPECTED: Record<string, string> = {
  // Where flights are a prize division, a late entry is taken until play begins.
  "stroke live": OPEN,
  "stableford live": OPEN,
  // A league's field changes week to week by nature; a casual round has no draw to protect.
  "league live": OPEN,
  "casual live": OPEN,
  // The first card is in and no sheet gives a closing time: late entries are closed, the lock stands as it is.
  "stroke liveWithResult": LIVE,
  "stableford liveWithResult": LIVE,
  // A round robin takes a late entrant only with a flight.
  "roundRobinFlights live": OPEN_WITH_FLIGHT,
  // The draw IS the field: nobody is added, so the lock stays as it was.
  "match live": LIVE,
  "knockout live": LIVE,
  "flightedKnockout live": LIVE,
  "teamCup live": LIVE,
};

describe("the field's lock, in words, per family and stage", () => {
  for (const family of FAMILIES) {
    for (const stage of ["live", "liveWithResult"] as Stage[]) {
      const key = `${family} ${stage}`;
      if (!(key in EXPECTED)) continue;
      it(`${key}: ${EXPECTED[key] === LIVE ? "unchanged" : "says what is still open"}`, () => {
        expect(said(family, stage).because).toBe(EXPECTED[key]);
      });
    }
  }

  it("a completed tournament keeps the completed words in every family", () => {
    for (const family of FAMILIES) expect(said(family, "completed").because, family).toBe(DONE);
  });

  it("only the words change: the scope, the way out and the correction stay the machine's", () => {
    const facts = at("stroke", "live");
    const raw = scopeLockOf(tournamentStatus(facts).locks, "field")!;
    const now = said("stroke", "live");
    expect({ ...now, because: "" }).toEqual({ ...raw, because: "" });
    expect(now.correctable).toBe(true);
  });

  it("never says Locked outright of a field that takes a late entry, and never promises one it refuses", () => {
    for (const family of FAMILIES) {
      const words = said(family, "live").because;
      const promises = /late entry can still be added/.test(words);
      // Worked by hand: the families where the draw is NOT the field.
      expect(promises, family).toBe(["stroke", "stableford", "roundRobinFlights", "league", "casual"].includes(family));
      // And every family and stage has its words written above (none left to chance).
      expect(`${family} live` in EXPECTED, family).toBe(true);
    }
  });
});
