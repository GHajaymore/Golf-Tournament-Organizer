import { describe, it, expect } from "vitest";
import {
  tournamentStatus,
  locksFor,
  lockFactsOf,
  scopeLockOf,
  lockRefusalWords,
  addRoundLockOf,
  openCorrectionOf,
  correctionRefusal,
  correctionReasonRefusal,
  correctionWords,
  correctionOpenedLine,
  correctionClosedLine,
  redrawRefusal,
  LOCK_SCOPES,
  type LockScope,
} from "../tournament-status";
import { FAMILY_FIXTURES, FAMILIES, facts, launched, completed } from "./tournament-facts-fixtures";
import { endOfClubDay } from "../club-clock";

/**
 * THE SCOPED LOCKS, AS AN ACTION AND A BANNER READ THEM (state machine PR 5a, 5b).
 *
 * `locksFor` is the lock-side read of the one `locksOf` the whole status uses,
 * so an action asking whether it may write (`refuseIfLocked`) and the banner on
 * the screen (`ScopeLockBanner`) give the dashboard's answer. Worked by hand from
 * the panel's rulings (proposal 3 Nov, section 3 and 8.1–8.3), never by calling
 * `configurationLocked`, the reader the scopes replace.
 */

/** Every state a lock turns on, for one family's fixture. */
const STATES = (base: ReturnType<typeof facts>) => [
  base,
  launched(base),
  { ...launched(base), configUnlocked: true },
  completed(base),
  { ...base, flightsConfirmed: true },
  { ...launched(base), flightsConfirmed: true },
  { ...launched(base), correction: { scope: "rounds" as LockScope, by: "A. Organizer", reason: "Wrong format", until: "2026-11-08T05:00:00.000Z" } },
  { ...launched(base), rounds: base.rounds.map((r) => ({ ...r, hasResult: true })) },
];

describe("the lock facts are enough to know a lock (the panel's cost ruling on 5a)", () => {
  for (const family of FAMILIES) {
    it(`${family}: locksFor of the narrow facts equals the dashboard's locks, in every state`, () => {
      const base = FAMILY_FIXTURES[family]();
      for (const f of STATES(base)) {
        expect(locksFor(f)).toEqual(tournamentStatus(f).locks);
        // The projection an action's narrow read reproduces (`lockFactsFor`): nothing a lock needs is cut.
        expect(locksFor(lockFactsOf(f))).toEqual(tournamentStatus(f).locks);
      }
    });
  }

  it("CONTROL: the projection drops what a lock does not read, so the equality above is not trivial", () => {
    const narrow = lockFactsOf(launched(facts()));
    expect(narrow).not.toHaveProperty("confirmed");
    expect(narrow).not.toHaveProperty("missingCards");
    expect(narrow.rounds[0]).not.toHaveProperty("label");
    expect(Object.keys(narrow).sort()).toEqual(["bracketMode", "configUnlocked", "correction", "flightsConfirmed", "league", "rounds", "shape", "status"]);
  });
});

describe("one locked scope, as plain values a screen is handed", () => {
  it("open is null — a draft locks no side", () => {
    const st = tournamentStatus(facts());
    for (const scope of LOCK_SCOPES) expect(scopeLockOf(st.locks, scope), scope).toBeNull();
  });

  it("a live tournament's sides: locked by launch, its reason, its way out — the committee correction — and correctable", () => {
    expect(scopeLockOf(locksFor(launched(facts())), "sides")).toEqual({
      scope: "sides",
      by: "launch",
      because: "Locked because the tournament is live.",
      wayOut: { says: "Make a committee correction", href: "/dashboard" },
      correctable: true,
    });
  });

  it("unlocked the old way, the sides open again (the legacy blanket Unlock, read until PR 9)", () => {
    expect(scopeLockOf(locksFor({ ...launched(facts()), configUnlocked: true }), "sides")).toBeNull();
  });

  it("completed: Reopen is the way out, and no correction opens it (TD Q2)", () => {
    const lock = scopeLockOf(locksFor(completed(facts())), "rounds");
    expect(lock?.by).toBe("completed");
    expect(lock?.wayOut).toEqual({ says: "Reopen it on the dashboard", href: "/dashboard" });
    expect(lock?.correctable).toBe(false);
  });

  it("money and the tee sheet were never under the blanket lock, and are not now", () => {
    const locks = locksFor(launched(facts()));
    expect(scopeLockOf(locks, "money")).toBeNull();
    expect(scopeLockOf(locks, "teeSheet")).toBeNull();
  });
});

describe("a refusal says the reason, then the way out with what the press was for — and knows who is reading", () => {
  it("the Organizer is offered the correction; an assistant is told to ask (panel on 5a: words)", () => {
    const live = scopeLockOf(locksFor(launched(facts())), "sides")!;
    expect(lockRefusalWords(live, "change teams", "organizer")).toBe("Locked because the tournament is live. Make a committee correction to change teams.");
    expect(lockRefusalWords(live, "change teams", "staff")).toBe("Locked because the tournament is live. Ask the Organizer to make a committee correction to change teams.");
  });

  it("Reopen is the Organizer's too; the draw's and the results' ways out read the same for anybody on the staff", () => {
    const done = scopeLockOf(locksFor(completed(facts())), "rounds")!;
    expect(lockRefusalWords(done, "add a round", "staff")).toBe("Locked because the tournament is completed. Ask the Organizer to reopen it on the dashboard to add a round.");
    const drawn = scopeLockOf(locksFor({ ...facts(), flightsConfirmed: true }), "flights")!;
    expect(lockRefusalWords(drawn, "move a player", "staff")).toBe("Locked because the draw is confirmed. Reopen the draw on Flights to move a player.");
    expect(lockRefusalWords(drawn, "move a player", "organizer")).toBe(lockRefusalWords(drawn, "move a player", "staff"));
  });

  it("never the words that leave the app (TD Q2): not “Configuration is locked”, not “Unlock”", () => {
    const live = scopeLockOf(locksFor(launched(facts())), "rounds")!;
    for (const who of ["organizer", "staff"] as const) {
      expect(lockRefusalWords(live, "change the handicap split", who)).not.toMatch(/Configuration is locked|Unlock/);
    }
  });
});

describe("adding a round asks one rule: refused only once completed (TD ruling on 5a, Q2)", () => {
  it("open before launch, open while live, refused when completed", () => {
    expect(addRoundLockOf(locksFor(facts()))).toBeNull();
    expect(addRoundLockOf(locksFor(launched(facts())))).toBeNull();
    expect(addRoundLockOf(locksFor(completed(facts())))).toMatchObject({ scope: "rounds", by: "completed", correctable: false });
  });

  it("a league adding next week's round while live is the case the rule exists for", () => {
    expect(addRoundLockOf(locksFor(launched(FAMILY_FIXTURES.league())))).toBeNull();
  });
});

describe("the committee correction opens one scope (TD Q2, panel 8.1)", () => {
  const live = launched(facts());
  const open = (scope: LockScope) => ({ ...live, correction: { scope, by: "A. Organizer", reason: "Wrong flight for one player", until: "2026-11-08T05:00:00.000Z" } });

  it("the corrected scope opens; every other scope stays locked", () => {
    const locks = locksFor(open("flights"));
    expect(scopeLockOf(locks, "flights")).toBeNull();
    for (const scope of ["details", "rounds", "field", "draw", "sides", "cup"] as const) expect(scopeLockOf(locks, scope)?.by, scope).toBe("launch");
  });

  it("a completed tournament's lock is not opened by a correction — Reopen is the remedy", () => {
    expect(scopeLockOf(locksFor({ ...completed(facts()), correction: open("rounds").correction }), "rounds")?.by).toBe("completed");
  });

  it("a flighted knockout's draw, locked by results, is not opened by a correction (never over recorded scores)", () => {
    const fk = launched(FAMILY_FIXTURES.flightedKnockout());
    const withResults = { ...fk, rounds: fk.rounds.map((r) => ({ ...r, hasResult: true })) };
    expect(scopeLockOf(locksFor(withResults), "draw")?.by).toBe("results");
    expect(scopeLockOf(locksFor({ ...withResults, correction: open("draw").correction }), "draw")?.by).toBe("results");
  });

  it("which scopes a correction may be opened on, in words", () => {
    expect(correctionRefusal(locksFor(live), "rounds")).toBeNull();
    expect(correctionRefusal(locksFor(facts()), "rounds")).toBe("That part of setup is not locked, so there is nothing to correct.");
    expect(correctionRefusal(locksFor(completed(facts())), "rounds")).toBe(
      "Locked because the tournament is completed. Reopen it on the dashboard instead — a committee correction cannot open it.",
    );
    expect(correctionRefusal(locksFor(live), "money")).toBe("That part of setup is not locked, so there is nothing to correct.");
  });

  it("the reason is 10 to 200 characters — it goes in Recent changes", () => {
    expect(correctionReasonRefusal("too short")).toMatch(/at least 10 characters/);
    expect(correctionReasonRefusal("Wrong flight for one player")).toBeNull();
    expect(correctionReasonRefusal("x".repeat(201))).toMatch(/200 characters/);
  });

  it("the banner's line names who and why", () => {
    expect(correctionWords(open("flights").correction!)).toBe("Open for a correction by A. Organizer: ‘Wrong flight for one player’");
  });

  /**
   * THE RECORD SAYS WHEN IT ENDS (panel review of 5b, must-fix 3), on the club's
   * calendar: the correction stands until 05:00 UTC on the 8th, which at a club
   * in Florida is midnight ending the 7th — so the line says the 7th, though the
   * server's day at that instant is the 8th.
   */
  it("the opening line says until when, by the club's day; the closing line says Done or replaced", () => {
    const c = { scope: "field" as LockScope, by: "A. Organizer", reason: "A walk-in after the first card", until: "2026-11-08T05:00:00.000Z" };
    expect(correctionOpenedLine(c, "America/New_York")).toBe(
      "A. Organizer opened the field for a correction: A walk-in after the first card — until midnight on Nov 7, 2026, club time",
    );
    // Auckland is ahead: 11:00 UTC on the 8th is midnight ending the 8th there.
    expect(correctionOpenedLine({ ...c, until: "2026-11-08T11:00:00.000Z" }, "Pacific/Auckland")).toMatch(/until midnight on Nov 8, 2026, club time$/);
    expect(correctionClosedLine(c, "A. Organizer")).toBe("A. Organizer closed the correction A. Organizer opened on the field");
    expect(correctionClosedLine(c, "B. Deputy", "replaced")).toBe("B. Deputy closed the correction A. Organizer opened on the field to open another");
  });
});

/**
 * A REDRAW NEVER GOES OVER RECORDED SCORES (panel review of 5b, must-fix 2).
 * The cell the review asked for: in a flighted knockout the draw's lock is OPEN
 * while live until the first knockout result (`locksOf`), so a lock could not
 * have refused a re-press on a scored qualifying round. The rule is the round's
 * cards, in every family, lock or no lock.
 */
describe("a redraw is refused by the round's scores, whatever the draw's lock says", () => {
  it("flighted knockout: the draw is open while live — and a round with cards is still refused", () => {
    const fk = launched(FAMILY_FIXTURES.flightedKnockout());
    expect(scopeLockOf(locksFor(fk), "draw")).toBeNull();
    expect(redrawRefusal("Round 1", 1)).toBe("Round 1 has scores — clear them on Score entry first.");
    expect(redrawRefusal("Round 1", 0)).toBeNull();
  });

  for (const family of FAMILIES) {
    it(`${family}: the answer does not change with the lock — open with no cards, refused with one, in every state`, () => {
      const base = FAMILY_FIXTURES[family]();
      for (const f of STATES(base)) {
        const drawLocked = scopeLockOf(locksFor(f), "draw") !== null;
        expect(redrawRefusal("Round 2", 0), `${family} draw ${drawLocked ? "locked" : "open"}`).toBeNull();
        expect(redrawRefusal("Round 2", 3), `${family} draw ${drawLocked ? "locked" : "open"}`).toBe("Round 2 has scores — clear them on Score entry first.");
      }
    });
  }

  it("never offers a committee correction, and names the way out that leaves a record", () => {
    const said = redrawRefusal("Round 2", 1) ?? "";
    expect(said).not.toMatch(/correction/i);
    expect(said).toMatch(/Score entry/);
    expect(redrawRefusal("", 1)).toBe("That round has scores — clear them on Score entry first.");
  });
});

describe("the correction is read off the row only while it stands", () => {
  const row = { correctionScope: "rounds", correctionReason: "Wrong format", correctionBy: "A. Organizer", correctionUntil: new Date("2026-11-08T05:00:00.000Z") };
  const before = new Date("2026-11-07T22:00:00.000Z");
  const after = new Date("2026-11-08T05:00:00.000Z");

  it("open before it lapses, null from the instant it does", () => {
    expect(openCorrectionOf(row, before)).toEqual({ scope: "rounds", by: "A. Organizer", reason: "Wrong format", until: "2026-11-08T05:00:00.000Z" });
    expect(openCorrectionOf(row, after)).toBeNull();
  });

  it("null when nothing is open, or the scope is not one the machine knows", () => {
    expect(openCorrectionOf({ correctionScope: null, correctionReason: null, correctionBy: null, correctionUntil: null }, before)).toBeNull();
    expect(openCorrectionOf({ ...row, correctionScope: "everything" }, before)).toBeNull();
    expect(openCorrectionOf({ ...row, correctionUntil: null }, before)).toBeNull();
  });

  it("lapses at the end of the CLUB's day: midnight in Florida is 05:00 UTC in November, 04:00 in July", () => {
    // The instant it was opened, and the instant the club's day ends — worked by hand from the offset.
    expect(endOfClubDay("America/New_York", new Date("2026-11-07T22:00:00.000Z")).toISOString()).toBe("2026-11-08T05:00:00.000Z");
    expect(endOfClubDay("America/New_York", new Date("2026-07-10T15:00:00.000Z")).toISOString()).toBe("2026-07-11T04:00:00.000Z");
    // Auckland is ahead of UTC: opened at 20:00 UTC on the 7th it is already the 8th there, which ends at 11:00 UTC.
    expect(endOfClubDay("Pacific/Auckland", new Date("2026-11-07T20:00:00.000Z")).toISOString()).toBe("2026-11-08T11:00:00.000Z");
    // A club with no zone keeps this machine's day: the instant is after the one it was asked at, within a day.
    const at = new Date("2026-11-07T12:00:00.000Z");
    const end = endOfClubDay("", at);
    expect(end.getTime()).toBeGreaterThan(at.getTime());
    expect(end.getTime() - at.getTime()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });
});
