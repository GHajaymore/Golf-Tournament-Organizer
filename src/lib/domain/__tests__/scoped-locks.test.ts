import { describe, it, expect } from "vitest";
import {
  tournamentStatus,
  locksFor,
  lockFactsOf,
  scopeLockOf,
  lockRefusalWords,
  addRoundLockOf,
  completionLockOf,
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
import { FAMILY_FIXTURES, FAMILIES, facts, launched, playedOut, completed } from "./tournament-facts-fixtures";
import type { Family, TournamentFacts } from "../tournament-status";
import { endOfClubDay } from "../club-clock";
import { teeSheetChangeAllowed, teeSheetChangeFactsOf } from "../tee-sheet-change";

/**
 * THE SCOPED LOCKS, AS AN ACTION AND A BANNER READ THEM (state machine PR 5a, 5b).
 *
 * `locksFor` is the lock-side read of the one `locksOf` the whole status uses,
 * so an action asking whether it may write (`refuseIfLocked`) and the banner on
 * the screen (`ScopeLockBanner`) give the dashboard's answer. Worked by hand from
 * the panel's rulings (proposal 3 Nov, section 3 and 8.1–8.3), never by calling
 * the predicate the scopes are built on (`setupLockedByLaunch` since PR 9b).
 */

/** Every state a lock turns on, for one family's fixture. */
const STATES = (base: ReturnType<typeof facts>) => [
  base,
  launched(base),
  // PR 9b: the retired blanket flag is no state a lock turns on; a played-out tournament is.
  playedOut(base),
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
    // No retired blanket flag among them since PR 9b: it is not a fact a lock reads.
    expect(Object.keys(narrow).sort()).toEqual(["bracketMode", "correction", "flightsConfirmed", "league", "rounds", "shape", "status"]);
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

  it("a casual round's sides are open while live: the family rule, not a flag (PR 9b; proposal 8.2)", () => {
    expect(scopeLockOf(locksFor(FAMILY_FIXTURES.casual()), "sides")).toBeNull();
    expect(scopeLockOf(locksFor(launched(FAMILY_FIXTURES.casual())), "sides")).toBeNull();
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

  it("the tee sheet is shut by a completed tournament, and only by that, with Reopen the way out (PR 7c)", () => {
    const lock = scopeLockOf(locksFor(completed(facts())), "teeSheet");
    expect(lock?.by).toBe("completed");
    expect(lock?.wayOut).toEqual({ says: "Reopen it on the dashboard", href: "/dashboard" });
  });

  /**
   * MONEY SHUTS AT COMPLETION AND NOWHERE ELSE (PR L; Ajay, 19 Nov 2026): what was OFFERED locks, Reopen unlocks it, and
   * nothing about money locks at launch. Not correctable: a committee correction is the answer to a lock by launch.
   */
  it("money is shut by a completed tournament, and only by that, with Reopen the way out — in every family (PR L)", () => {
    for (const family of FAMILIES) {
      const base = FAMILY_FIXTURES[family]();
      for (const [name, f] of [["setting up", base], ["live", launched(base)], ["played out", playedOut(base)]] as const) {
        expect(scopeLockOf(locksFor(f), "money"), `${family}, ${name}`).toBeNull();
      }
      const lock = scopeLockOf(locksFor(completed(base)), "money");
      expect(lock, family).toMatchObject({ by: "completed", wayOut: { says: "Reopen it on the dashboard", href: "/dashboard" }, correctable: false });
    }
  });

  /**
   * THE TEE SHEET'S BANNER AND ITS REFUSAL CANNOT PART (state machine, phase 2 section 2.3). "A completed tournament
   * shuts the sheet" is written twice — in `locksOf` (the banner) and in `teeSheetChangeAllowed` (the actions and the
   * screen's doors) — so this holds one to the other over every family, every status (draft, live, completed), every step of a round
   * (before the draw, after it, after scores) and every change the sheet takes.
   */
  it("locksFor(f).teeSheet.locked equals !teeSheetChangeAllowed(…).ok — every family, status, step and change", () => {
    let compared = 0;
    for (const family of FAMILIES) {
      const base = FAMILY_FIXTURES[family]();
      for (const status of ["draft", "live", "completed"]) {
        for (const round of [
          { teeSheetSaved: null, hasResult: false },
          { teeSheetSaved: true, hasResult: false },
          { teeSheetSaved: true, hasResult: true },
        ]) {
          const f = { ...base, status, rounds: base.rounds.map((r) => ({ ...r, ...round })) };
          const banner = locksFor(f).teeSheet.locked;
          for (const r of f.rounds) {
            const facts = teeSheetChangeFactsOf(f, r.id)!;
            for (const ask of [{ kind: "save", publish: true }, { kind: "save", publish: false }, { kind: "publish" }, { kind: "unpublish" }, { kind: "place" }, { kind: "move" }, { kind: "replace" }] as const) {
              expect(banner, `${family} · ${status} · ${r.id} · ${ask.kind}`).toBe(!teeSheetChangeAllowed(facts, ask).ok);
              compared++;
            }
          }
        }
      }
    }
    // CONTROL: the sweep compared something, and the two answers are not constant.
    expect(compared).toBeGreaterThan(500);
    expect(locksFor({ ...FAMILY_FIXTURES.stroke(), status: "completed" }).teeSheet.locked).toBe(true);
    expect(locksFor({ ...FAMILY_FIXTURES.stroke(), status: "live" }).teeSheet.locked).toBe(false);
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

describe("the completion-only reader (B115): a live league is drawn every week, a finished one is not", () => {
  it("is open before launch and while live, for every scope, and set only once completed", () => {
    for (const scope of LOCK_SCOPES) {
      expect(completionLockOf(locksFor(facts()), scope), `${scope} before launch`).toBeNull();
      expect(completionLockOf(locksFor(launched(facts())), scope), `${scope} while live`).toBeNull();
    }
    expect(completionLockOf(locksFor(completed(facts())), "sides")).toMatchObject({ scope: "sides", by: "completed", correctable: false });
  });

  it("sides is locked by launch for a league (the control: the reader, not the scope, is what keeps a live league open)", () => {
    const live = locksFor(launched(FAMILY_FIXTURES.league()));
    expect(scopeLockOf(live, "sides")).toMatchObject({ by: "launch" });
    expect(completionLockOf(live, "sides")).toBeNull();
    expect(completionLockOf(locksFor(completed(FAMILY_FIXTURES.league())), "sides")).toMatchObject({ by: "completed" });
  });

  it("adding a round is the same answer through it, in every family and status", () => {
    for (const family of Object.keys(FAMILY_FIXTURES) as (keyof typeof FAMILY_FIXTURES)[]) {
      for (const f of [FAMILY_FIXTURES[family](), launched(FAMILY_FIXTURES[family]()), completed(FAMILY_FIXTURES[family]())]) {
        expect(addRoundLockOf(locksFor(f)), `${family}`).toEqual(completionLockOf(locksFor(f), "rounds"));
      }
    }
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
    // Money shut at completion is Reopen's, never a correction's (Ajay, 19 Nov).
    expect(correctionRefusal(locksFor(completed(facts())), "money")).toBe(
      "Locked because the tournament is completed. Reopen it on the dashboard instead — a committee correction cannot open it.",
    );
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

/**
 * THE 8.2 TABLE, BY HAND (state machine PR 9b, test plan B2). Every family × the four steps ×
 * every scope, each cell a literal — never built from `setupLockedByLaunch`, which would be
 * the code agreeing with itself. From the proposal of 3 Nov, 8.2 ("Casual: locks none"; every
 * other family locked from launch, the way out a committee correction) and 8.1 (completed is
 * locked, the way out Reopen — Rule 20.2e), with the two rules 9b does not touch:
 *
 *   - money is under no lock until the tournament is completed (Ajay, 19 Nov: what was offered locks at completion, Reopen is the way out; the ledger never locks);
 *   - the tee sheet was never under the launch lock: a completed tournament shuts it, every
 *     family (PR 7c, `teeSheetChangeAllowed`) — a casual round's too, as today;
 *   - a knockout in flights keeps its draw open while live until the first result (J07), so
 *     its play-over row (every round played) is locked by results.
 *
 * Columns, in `LOCK_SCOPES` order: details, rounds, field, flights, draw, sides, cup, money, teeSheet.
 * o = open, L = locked by launch, C = locked by completion, R = locked by results.
 */
type Cell = "o" | "L" | "C" | "R";
type Row = readonly [Cell, Cell, Cell, Cell, Cell, Cell, Cell, Cell, Cell];
const STEPS = ["setting-up", "live", "play-over", "completed"] as const;
const ALL_OPEN: Row = ["o", "o", "o", "o", "o", "o", "o", "o", "o"];
const LIVE_ROW: Row = ["L", "L", "L", "L", "L", "L", "L", "o", "o"];
const DONE_ROW: Row = ["C", "C", "C", "C", "C", "C", "C", "C", "C"];

const TABLE_8_2: Record<Family, Record<(typeof STEPS)[number], Row>> = {
  stroke: { "setting-up": ALL_OPEN, live: LIVE_ROW, "play-over": LIVE_ROW, completed: DONE_ROW },
  stableford: { "setting-up": ALL_OPEN, live: LIVE_ROW, "play-over": LIVE_ROW, completed: DONE_ROW },
  match: { "setting-up": ALL_OPEN, live: LIVE_ROW, "play-over": LIVE_ROW, completed: DONE_ROW },
  roundRobinFlights: { "setting-up": ALL_OPEN, live: LIVE_ROW, "play-over": LIVE_ROW, completed: DONE_ROW },
  knockout: { "setting-up": ALL_OPEN, live: LIVE_ROW, "play-over": LIVE_ROW, completed: DONE_ROW },
  flightedKnockout: {
    "setting-up": ALL_OPEN,
    live: ["L", "L", "L", "L", "o", "L", "L", "o", "o"],
    "play-over": ["L", "L", "L", "L", "R", "L", "L", "o", "o"],
    completed: DONE_ROW,
  },
  teamCup: { "setting-up": ALL_OPEN, live: LIVE_ROW, "play-over": LIVE_ROW, completed: DONE_ROW },
  league: { "setting-up": ALL_OPEN, live: LIVE_ROW, "play-over": LIVE_ROW, completed: DONE_ROW },
  // 8.2: "Casual: locks none." Open at every step; only the tee sheet shuts once completed (see above).
  casual: {
    "setting-up": ALL_OPEN,
    live: ALL_OPEN,
    "play-over": ALL_OPEN,
    completed: ["o", "o", "o", "o", "o", "o", "o", "C", "C"],
  },
};

const BY: Record<Exclude<Cell, "o">, string> = { L: "launch", C: "completed", R: "results" };

/** A family's fixture at one step, as the organizer gets it there. */
function atStep(family: Family, step: (typeof STEPS)[number]): TournamentFacts {
  const base = FAMILY_FIXTURES[family]();
  if (step === "setting-up") return { ...base, status: "draft" };
  if (step === "live") return launched(base);
  if (step === "play-over") return playedOut(base);
  return completed(base);
}

describe("the 8.2 table by hand: nine families × four steps × every scope (PR 9b, B2)", () => {
  for (const family of Object.keys(TABLE_8_2) as Family[]) {
    for (const step of STEPS) {
      it(`${family}, ${step}`, () => {
        const locks = locksFor(atStep(family, step));
        const got = LOCK_SCOPES.map((s) => {
          const l = locks[s];
          return l.locked ? (Object.entries(BY).find(([, by]) => by === l.by)?.[0] ?? l.by) : "o";
        });
        expect(got, `${family} at ${step}, in the order ${LOCK_SCOPES.join(", ")}`).toEqual([...TABLE_8_2[family][step]]);
      });
    }
  }

  it("the way out: a committee correction while live, Reopen once completed — every family that locks", () => {
    for (const family of Object.keys(TABLE_8_2) as Family[]) {
      if (family === "casual") continue;
      expect(scopeLockOf(locksFor(atStep(family, "live")), "details"), family).toMatchObject({ wayOut: { says: "Make a committee correction" }, correctable: true });
      expect(scopeLockOf(locksFor(atStep(family, "completed")), "details"), family).toMatchObject({ wayOut: { says: "Reopen it on the dashboard" }, correctable: false });
    }
  });

  it("CONTROL: the table covers every family and every scope the machine knows", () => {
    expect(Object.keys(TABLE_8_2).sort()).toEqual([...FAMILIES].sort());
    expect(LOCK_SCOPES).toEqual(["details", "rounds", "field", "flights", "draw", "sides", "cup", "money", "teeSheet"]);
    // And each step's fixture IS that step, so a row is not read off the wrong one.
    for (const family of FAMILIES) {
      expect(tournamentStatus(atStep(family, "setting-up")).step, family).toBe("setting-up");
      expect(tournamentStatus(atStep(family, "completed")).step, family).toBe("completed");
    }
  });
});
