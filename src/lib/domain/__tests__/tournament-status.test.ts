import { describe, it, expect } from "vitest";
import { tournamentStatus, tournamentFamily, LOCK_SCOPES, type TournamentFacts } from "../tournament-status";
import { FAMILY_FIXTURES, FAMILIES, facts, round, launched, playedOut, completed } from "./tournament-facts-fixtures";

/**
 * THE STATE MACHINE, FAMILY BY FAMILY — worked from the Rules of Golf and the
 * Committee Procedures, by hand, never by calling the readers it replaces
 * (those are held beside it in `tournament-status-shadow.test.ts`).
 *
 * Each expectation names the rule it comes from. Where the app's own ruling is
 * the authority (the panel of 3 Nov, section 8 of the proposal), it says so.
 */

const s = tournamentStatus;
const keyOf = (f: TournamentFacts) => s(f).setup.current?.key ?? null;

describe("the family is the tournament's shape, first match wins", () => {
  for (const family of FAMILIES) {
    it(`the ${family} fixture is a ${family}`, () => {
      expect(tournamentFamily(FAMILY_FIXTURES[family]())).toBe(family);
    });
  }

  it("a 36-hole medal is a league by the sidebar's own rule (more than one weekly round)", () => {
    // Recorded, not endorsed: `navForRole`'s isLeague is the definition today,
    // and one rule is better than two. The panel is asked about it in the PR.
    const two = facts({ rounds: [round({ id: "r1", position: 0 }), round({ id: "r2", position: 1 })] });
    expect(tournamentFamily(two)).toBe("league");
  });
});

describe("every family, ready to launch", () => {
  for (const family of FAMILIES.filter((f) => f !== "casual")) {
    it(`${family}: Setting up, nothing holds, Launch is offered and allowed`, () => {
      const st = s(FAMILY_FIXTURES[family]());
      expect(st.step).toBe("setting-up");
      expect(st.chip).toBe("Setting up");
      expect(st.setup.current).toBeNull();
      expect(st.refusals.launch).toBeNull();
      expect(st.nextAction).toMatchObject({ kind: "launch", enabled: true, disabledBecause: null, wayOut: null });
      expect(st.journey).toBe("launch");
    });
  }

  it("casual: created live, no setup at all, and no next action (never on the secretary's home)", () => {
    const st = s(FAMILY_FIXTURES.casual());
    expect(st.step).toBe("live");
    expect(st.setup.of).toBe(0);
    expect(st.nextAction).toBeNull();
    // Created with configUnlocked: true (match-setup.ts), so nothing is locked.
    for (const scope of LOCK_SCOPES) expect(st.locks[scope].locked).toBe(false);
  });
});

describe("stroke play and Stableford", () => {
  it("one division is a complete setup — flights are optional (Committee Procedures 5A; Golf Pro, 8.2)", () => {
    // Divisions are a Term the Committee MAY set; nothing in the Rules needs one.
    for (const base of [FAMILY_FIXTURES.stroke(), FAMILY_FIXTURES.stableford()]) {
      const st = s({ ...base, groups: 0 });
      expect(st.setup.current).toBeNull();
      expect(st.refusals.launch).toBeNull();
      const flights = st.setup.steps.find((x) => x.key === "grouping")!;
      expect(flights.holds).toBe(false);
      expect(flights.missing).toBe("Optional — one field.");
      expect(st.warnings.some((w) => w.href === "/grouping")).toBe(true);
    }
  });

  it("flights made with one player left out warns and never holds (J04)", () => {
    const st = s({ ...FAMILY_FIXTURES.stroke(), unplacedInFlights: 1 });
    expect(st.refusals.launch).toBeNull();
    expect(st.warnings.find((w) => w.href === "/grouping")?.says).toBe("1 player is in the field but in no flight.");
  });

  it("no dates holds launch on the details step even with a venue (D4)", () => {
    // A tournament published to its members with no date cannot be planned around.
    const st = s({ ...FAMILY_FIXTURES.stroke(), dated: false, venued: true });
    expect(keyOf({ ...FAMILY_FIXTURES.stroke(), dated: false })).toBe("event");
    expect(st.refusals.launch).toMatch(/no dates/);
    expect(st.nextAction).toMatchObject({ kind: "launch", enabled: false, wayOut: { href: "/event" } });
  });

  it("a round with no course card holds on Rounds & formats, where the card is chosen (D4b)", () => {
    const st = s({ ...FAMILY_FIXTURES.stroke(), missingCards: [{ label: "Round 1", course: "Invented Links" }] });
    expect(st.setup.current?.key).toBe("stages");
    expect(st.refusals.launch).not.toBeNull();
  });

  it("an undated later round is a warning, not a hold, outside a league (Golf Pro table, 8.2)", () => {
    const two = facts({
      rounds: [round({ id: "r1", position: 0, type: "Round Robin", drawsPairings: true, matches: 6, teeSheetSaved: null }), round({ id: "r2", position: 1, type: "Single Match Stage", scheduled: false, teeSheetSaved: null })],
    });
    expect(tournamentFamily(two)).toBe("roundRobinFlights");
    const st = s(two);
    expect(st.setup.steps.find((x) => x.key === "stages")).toMatchObject({ done: false, holds: false });
    expect(st.refusals.launch).toBeNull();
  });

  it("a team round needs every confirmed player on a side (Golf Pro, 8.2: a player on no side cannot be scored)", () => {
    const team = { ...FAMILY_FIXTURES.stroke(), teams: { needed: true, sides: 3, unsided: 1 } };
    expect(s(team).setup.current?.key).toBe("teams");
    expect(s(team).refusals.launch).toBe("1 player is not on a side, so their team rounds cannot be scored. Put them on one on Teams & pairs, then launch.");
    expect(s({ ...team, teams: { needed: true, sides: 3, unsided: 0 } }).refusals.launch).toBeNull();
  });

  it("play is over when every round is closed — Live until then (Rule 3.3b, the committee closes the round)", () => {
    const live = launched(FAMILY_FIXTURES.stroke());
    expect(s(live).step).toBe("live");
    const over = playedOut(FAMILY_FIXTURES.stroke());
    expect(s(over).step).toBe("play-over");
    expect(s(over).chip).toBe("Play over");
    expect(s(over).chipDetail).toBe("Every round closed · results not released");
  });

  it("play over with a card awaiting sign-off refuses Complete and says where (Rule 3.3b(2); D3)", () => {
    const over = { ...playedOut(FAMILY_FIXTURES.stroke()), review: { pendingConfirmations: 1, disputed: 0 } };
    const st = s(over);
    expect(st.nextAction).toMatchObject({ kind: "complete", enabled: false, wayOut: { href: "/entry" } });
    expect(st.nextAction?.disabledBecause).toMatch(/waiting to be signed off/);
  });

  it("a dispute is refused before a sign-off — the Committee owes the ruling first (Rule 20.1c(3), 20.2b)", () => {
    const over = { ...playedOut(FAMILY_FIXTURES.stroke()), review: { pendingConfirmations: 2, disputed: 1 } };
    expect(s(over).refusals.complete).toMatch(/disputed/);
  });

  it("nothing scored refuses Complete; an unplayed round is asked about, not refused (Committee Procedures; #973)", () => {
    const blank = launched(facts({ rounds: [round({ id: "r1", position: 0 }), round({ id: "r2", position: 1 })] }));
    expect(s(blank).refusals.complete).toBe("Nothing has been scored yet, so there is no result to complete.");
    const half = { ...blank, rounds: [{ ...blank.rounds[0], hasResult: true }, blank.rounds[1]] };
    expect(s(half).refusals.complete).toBeNull();
    expect(s(half).nextAction?.asks).toMatch(/^Round 2 has no scores/);
  });
});

describe("a single match", () => {
  it("needs two players (Golf Pro, 8.2: a match of one has nothing to play)", () => {
    const one = { ...FAMILY_FIXTURES.match(), confirmed: 1 };
    expect(keyOf(one)).toBe("registration");
    expect(s(one).refusals.launch).toMatch(/^A match needs two players/);
  });

  it("needs its match made when it is the first round", () => {
    const bare = FAMILY_FIXTURES.match();
    bare.rounds[0] = { ...bare.rounds[0], matches: 0 };
    expect(keyOf(bare)).toBe("stages");
  });

  it("is never held on Flights (8.2: not shown)", () => {
    const st = s({ ...FAMILY_FIXTURES.match(), groups: 0 });
    expect(st.setup.steps.some((x) => x.key === "grouping")).toBe(false);
    expect(st.setup.current).toBeNull();
  });

  it("is over when the match is over, whether or not the round is closed (Rule 3.2a(1); panel change 3)", () => {
    // Won 3&2: a lead greater than the holes remaining ends the match.
    const live = launched(FAMILY_FIXTURES.match());
    live.rounds[0] = { ...live.rounds[0], hasResult: true, matchesOver: 1, closed: false };
    expect(s(live).step).toBe("play-over");
    expect(s(live).chipDetail).toBe("Every match over · results not released");
    // Level after 18 is NOT over: the match goes on, hole by hole (Rule 3.2a(4)).
    live.rounds[0] = { ...live.rounds[0], matchesOver: 0 };
    expect(s(live).step).toBe("live");
  });
});

describe("a round robin in flights", () => {
  it("holds launch while a player is in no flight — no flight, no fixtures (Golf Pro, 8.2)", () => {
    const st = s({ ...FAMILY_FIXTURES.roundRobinFlights(), unplacedInFlights: 2 });
    expect(st.setup.current?.key).toBe("grouping");
    expect(st.refusals.launch).toBe("2 players are in no flight, so they have no matches. Put them in one on Flights, then launch.");
  });

  it("holds launch with no pairings, in today's words", () => {
    const f = FAMILY_FIXTURES.roundRobinFlights();
    f.rounds[0] = { ...f.rounds[0], matches: 0 };
    expect(s(f).refusals.launch).toBe("Round 1 has no pairings, so there are no matches to score. Generate them on Rounds & formats, then launch.");
  });

  it("while live, a cut-fed round whose qualifier has closed is the next thing to do: draw it", () => {
    const f = launched(
      facts({
        rounds: [
          round({ id: "r1", position: 0, type: "Round Robin", drawsPairings: true, matches: 12, hasResult: true, closed: true, teeSheetSaved: null }),
          round({ id: "r2", position: 1, type: "Round Robin", drawsPairings: true, cutFed: true, matches: 0, teeSheetSaved: null }),
        ],
      }),
    );
    expect(s(f).nextAction).toMatchObject({ kind: "draw", label: "Generate Round 2 pairings", href: "/stages" });
  });
});

describe("a knockout", () => {
  it("needs at least two players", () => {
    expect(s({ ...FAMILY_FIXTURES.knockout(), confirmed: 1 }).refusals.launch).toMatch(/^A knockout needs at least two players/);
  });

  it("is over when its Final has a winner (Rule 3.2: the Final decides the match-play competition)", () => {
    const f = launched(FAMILY_FIXTURES.knockout());
    expect(s(f).step).toBe("live");
    const won = { ...f, knockout: { ...f.knockout!, draws: [{ label: "", entrants: 8, finalDecided: true }] } };
    expect(s(won).step).toBe("play-over");
    expect(s(won).chipDetail).toBe("Final decided · results not released");
    // Nobody closes a Bracket Stage, so this is NOT `playOverOf` (D3).
    expect(won.rounds.every((r) => !r.closed)).toBe(true);
  });

  it("with two draws (split, plate) waits for BOTH Finals (F2)", () => {
    const f = launched({ ...FAMILY_FIXTURES.knockout(), bracketMode: "plate" });
    const one = { ...f, knockout: { draws: [{ label: "Main draw", entrants: 8, finalDecided: true }, { label: "Plate", entrants: 4, finalDecided: false }], thirdPlace: { on: false, decided: false } } };
    expect(s(one).step).toBe("live");
    one.knockout.draws[1].finalDecided = true;
    expect(s(one).step).toBe("play-over");
    expect(s(one).chipDetail).toBe("Every final decided · results not released");
  });

  it("with a play-off for third waits for it too (F3: a Term the committee may add)", () => {
    const f = playedOut(FAMILY_FIXTURES.knockout());
    const third = { ...f, knockout: { ...f.knockout!, thirdPlace: { on: true, decided: false } } };
    expect(s(third).step).toBe("live");
    expect(s({ ...third, knockout: { ...third.knockout, thirdPlace: { on: true, decided: true } } }).step).toBe("play-over");
  });

  it("does not wait on a draw of one — there is no tie in it to decide", () => {
    const f = launched(FAMILY_FIXTURES.knockout());
    const split = { ...f, bracketMode: "split", knockout: { draws: [{ label: "Flight A", entrants: 2, finalDecided: true }, { label: "Flight B", entrants: 1, finalDecided: false }], thirdPlace: { on: false, decided: false } } };
    expect(s(split).step).toBe("play-over");
  });

  it("results before launch: still Setting up, underway, and Launch says so (TD Q5; D2)", () => {
    const f = FAMILY_FIXTURES.knockout();
    f.rounds[0] = { ...f.rounds[0], hasResult: true };
    const st = s(f);
    expect(st.step).toBe("setting-up");
    expect(st.underWayUnlaunched).toBe(true);
    expect(st.journey).toBe("play");
    expect(st.chip).toBe("Setting up · results in");
    expect(st.nextAction?.label).toBe("Launch it — it’s being played");
    // The scoring gate stays out of the way of a tie already played.
    expect(st.refusals.play).toBeNull();
  });
});

describe("a knockout in flights", () => {
  it("keeps its division open after launch until the first result (knockouts doc; J07)", () => {
    const f = launched(FAMILY_FIXTURES.flightedKnockout());
    expect(s(f).locks.draw.locked).toBe(false);
    f.rounds[0] = { ...f.rounds[0], hasResult: true };
    const l = s(f).locks.draw;
    expect(l).toMatchObject({ locked: true, by: "results", correctable: false });
  });

  it("is over only when all THREE flights' Finals are decided", () => {
    const f = launched(FAMILY_FIXTURES.flightedKnockout());
    const draws = f.knockout!.draws.map((d, i) => ({ ...d, finalDecided: i < 2 }));
    expect(s({ ...f, knockout: { ...f.knockout!, draws } }).step).toBe("live");
    expect(s(playedOut(FAMILY_FIXTURES.flightedKnockout())).step).toBe("play-over");
  });
});

describe("a team cup", () => {
  it("needs two teams and everybody on one (Golf Pro, 8.2)", () => {
    expect(keyOf({ ...FAMILY_FIXTURES.teamCup(), cup: { flights: 3, unplaced: 0 } })).toBe("cup");
    const loose = s({ ...FAMILY_FIXTURES.teamCup(), cup: { flights: 2, unplaced: 1 } });
    expect(loose.setup.current?.key).toBe("cup");
    expect(loose.refusals.launch).toMatch(/^1 player is not on a team/);
  });

  it("is over the moment the cup is decided, sessions still out (a cup is won on reaching the target)", () => {
    const f = launched(FAMILY_FIXTURES.teamCup());
    expect(s({ ...f, cupDecided: false }).step).toBe("live");
    const st = s({ ...f, cupDecided: true });
    expect(st.step).toBe("play-over");
    expect(st.chipDetail).toBe("Cup decided · results not released");
  });
});

describe("a league", () => {
  it("needs only the NEXT unplayed week dated — a deadline is a full answer (Golf Pro Q4; J08)", () => {
    const f = FAMILY_FIXTURES.league();
    f.rounds = f.rounds.map((r, i) => ({ ...r, scheduled: i === 0 }));
    expect(s(f).refusals.launch).toBeNull();
    expect(s(f).setup.steps.find((x) => x.key === "stages")).toMatchObject({ holds: false });
    f.rounds[0] = { ...f.rounds[0], scheduled: false };
    expect(s(f).setup.current?.key).toBe("stages");
    expect(s(f).refusals.launch).toBe("Round 1 has no day and no deadline, so nobody knows when to play it. Give it one on Rounds & formats, then launch.");
  });

  it("while live, the next undated week is the next thing to do", () => {
    const f = launched(FAMILY_FIXTURES.league());
    f.rounds = f.rounds.map((r, i) => ({ ...r, hasResult: i === 0, closed: i === 0, scheduled: i === 0 }));
    expect(s(f).nextAction).toMatchObject({ kind: "schedule", label: "Set Round 2’s day" });
  });
});

describe("locks: a scope, a reason and a way out", () => {
  it("live: today's blanket lock, by launch, correctable, with the way out", () => {
    const st = s(launched(FAMILY_FIXTURES.stroke()));
    expect(st.locks.details).toEqual({ locked: true, by: "launch", because: "Locked because the tournament is live.", wayOut: { says: "Unlock it on the dashboard", href: "/dashboard" }, correctable: true });
    // Money and the tee sheet were never under it.
    expect(st.locks.money.locked).toBe(false);
    expect(st.locks.teeSheet.locked).toBe(false);
  });

  it("a confirmed draw locks the flights, correctably (today's words kept: reopen it)", () => {
    const st = s({ ...FAMILY_FIXTURES.stroke(), flightsConfirmed: true });
    expect(st.locks.flights).toMatchObject({ locked: true, by: "draw", correctable: true, wayOut: { href: "/grouping" } });
  });

  it("completed: locked by completion, never by a correction (Rule 20.2e — the result is final)", () => {
    const st = s(completed(FAMILY_FIXTURES.stroke()));
    expect(st.locks.rounds).toMatchObject({ locked: true, by: "completed", correctable: false });
    expect(st.nextAction).toMatchObject({ kind: "reopen", enabled: true });
  });

  it("a committee correction opens ONE correctable scope, and not a lock by results", () => {
    const f = { ...launched(FAMILY_FIXTURES.stroke()), correction: { scope: "flights" as const, by: "A. Organizer", reason: "Wrong flight for one player", until: "2026-11-03" } };
    const st = s(f);
    expect(st.locks.flights.locked).toBe(false);
    expect(st.locks.details.locked).toBe(true);
    const ko = launched(FAMILY_FIXTURES.flightedKnockout());
    ko.rounds[0] = { ...ko.rounds[0], hasResult: true };
    expect(s({ ...ko, correction: { scope: "draw", by: "A. Organizer", reason: "Seeded the wrong way round", until: "2026-11-03" } }).locks.draw.locked).toBe(true);
  });
});

describe("D7 and D8 — readers on #994, not on main: the machine's answer is pinned", () => {
  it("D7: a one-round medal with no day for its round is not nagged for one — the event's date answers it", () => {
    const f = FAMILY_FIXTURES.stroke();
    f.rounds[0] = { ...f.rounds[0], scheduled: false };
    const st = s(f);
    expect(st.setup.steps.find((x) => x.key === "stages")?.done).toBe(true);
    expect(st.warnings.some((w) => /no day/.test(w.says))).toBe(false);
  });

  it("D7: a round robin asks for no tee sheet — its fixtures are not a tee time", () => {
    const st = s({ ...FAMILY_FIXTURES.roundRobinFlights() });
    expect(st.warnings.some((w) => w.href === "/foursomes")).toBe(false);
  });

  it("D8: a launched round with no result is not started, whatever the day", () => {
    const f = launched(FAMILY_FIXTURES.stroke());
    f.rounds[0] = { ...f.rounds[0], scheduled: false };
    expect(s(f).rounds[0].state).toBe("not-started");
    f.rounds[0] = { ...f.rounds[0], hasResult: true };
    expect(s(f).rounds[0].state).toBe("under-way");
  });
});
