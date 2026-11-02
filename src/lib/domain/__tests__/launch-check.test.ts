import { describe, it, expect } from "vitest";
import { setupFlow, type SetupFacts, type SetupRound } from "../setup-flow";
import { screenName } from "@/lib/nav";
import { warningText, launchRows } from "../launch-check";

/**
 * LAUNCH READS SETUP (gap G3, 2026-10-31) — worked from the panel's ruling, not
 * from the code:
 *
 *   REFUSE what makes a round unscorable: a round played in sides with no sides
 *   (golf professional: nothing to put a score against); a team cup without its
 *   two teams; a round robin with no pairings (no matches, no result).
 *   WARN about the rest the setup flow says is open: no flights on a medal, a
 *   round with no day, players left off a side, the money question, no tee sheet
 *   (tournament director: a club may launch without a tee sheet or a money answer).
 *
 * Asked through `setupFlow(...).launch`, which is what the dashboard's button and
 * `launchTournament` read via `launchCheckFor`.
 */
const medal = (over: Partial<SetupRound> = {}): SetupRound => ({
  label: "Round 1",
  drawsPairings: false,
  scheduled: true,
  scorable: true,
  cutFed: false,
  matches: 0,
  teeSheetSaved: true,
  ...over,
});

/** A dated, entered, money-answered, flighted one-round medal: nothing open. */
const READY: SetupFacts = {
  confirmed: 8,
  rounds: [medal()],
  groups: 2,
  named: true,
  dated: true,
  venued: true,
  moneyAnswered: true,
  launched: false,
  playingRounds: 1,
  missingCards: [],
};

const launchOf = (over: Partial<SetupFacts> = {}) => {
  const l = setupFlow({ ...READY, ...over }, screenName).launch;
  return { refusal: l.refusal, warnings: l.warnings.map(warningText), stepsOpen: l.stepsOpen };
};

describe("what launch refuses", () => {
  it("CONTROL: an ordinary medal with nothing open launches, and is warned of nothing", () => {
    expect(launchOf()).toEqual({ refusal: null, warnings: [], stepsOpen: 0 });
  });

  it("refuses a scramble nobody has been put in a side for, naming the screen", () => {
    const r = launchOf({ teams: { needed: true, sides: 0, unsided: 8 } });
    expect(r.refusal).toBe(
      "This tournament is played in sides and none are made yet, so its team rounds cannot be scored. Make the sides on Teams & pairs, then launch.",
    );
    expect(r.refusal).toContain(screenName("/teams"));
  });

  it("does not refuse a medal whose sides question does not exist", () => {
    expect(launchOf({ teams: { needed: false, sides: 0, unsided: 8 } }).refusal).toBeNull();
  });

  it("refuses a cup without its two teams, and launches one with them", () => {
    const cupRound = medal({ teeSheetSaved: undefined });
    expect(launchOf({ rounds: [cupRound], cup: { flights: 0, unplaced: 8 } }).refusal).toContain("needs its two teams");
    expect(launchOf({ rounds: [cupRound], cup: { flights: 3, unplaced: 0 } }).refusal).toContain("this one has 3");
    expect(launchOf({ rounds: [cupRound], cup: { flights: 2, unplaced: 0 } }).refusal).toBeNull();
  });

  it("refuses a round robin with no pairings, and says which screen comes first", () => {
    const rr = medal({ drawsPairings: true, teeSheetSaved: undefined });
    expect(launchOf({ rounds: [rr] }).refusal).toBe(
      "Round 1 has no pairings, so there are no matches to score. Generate them on Rounds & formats, then launch.",
    );
    expect(launchOf({ rounds: [rr], groups: 0 }).refusal).toContain("Make flights on Flights and generate the pairings");
    expect(launchOf({ rounds: [rr, { ...rr, label: "Round 2" }], playingRounds: 2 }).refusal).toContain("Round 1 and Round 2 have no pairings");
    // Drawn, it launches; a cut-fed round cannot be drawn yet and is not held against it.
    expect(launchOf({ rounds: [{ ...rr, matches: 6 }] }).refusal).toBeNull();
    expect(launchOf({ rounds: [{ ...rr, matches: 6 }, { ...rr, label: "Round 2", cutFed: true }], playingRounds: 2 }).refusal).toBeNull();
  });

  it("is the same refusal the rail shows once every step is done", () => {
    const flow = setupFlow({ ...READY, rounds: [medal({ drawsPairings: true, matches: 0 })] }, screenName);
    // Not done, so the rail does not say "ready"; launch still says why.
    expect(flow.complete).toBe(false);
    expect(flow.launch.refusal).toContain("no pairings");
  });
});

describe("what launch only warns about", () => {
  it("warns, never refuses, over the money question, flights and a tee sheet — and says what Unlock means", () => {
    const r = launchOf({ moneyAnswered: false, groups: 0, rounds: [medal({ teeSheetSaved: false })] });
    expect(r.refusal).toBeNull();
    expect(r.warnings).toEqual([
      "There are no flights, so the whole field plays as one division. Make flights on Flights — after launch, this needs Unlock first.",
      "Nobody has said how money works here, so the app is guessing. Answer it on Prizes & payouts — you can still do this after launch.",
      "Round 1 has no tee sheet saved, so nobody has a time to turn up for. Draw one on Tee sheet — you can still do this after launch.",
    ]);
    // The rail's own count: flights and money are two of its steps; the tee sheet is not a step.
    expect(r.stepsOpen).toBe(2);
  });

  it("names both days of a two-day outing with no tee sheets, and a round with no day", () => {
    const two = [medal({ teeSheetSaved: false, scheduled: false }), medal({ label: "Round 2", teeSheetSaved: false })];
    const r = launchOf({ rounds: two, playingRounds: 2 });
    expect(r.refusal).toBeNull();
    expect(r.warnings).toContain(
      "Round 1 has no day and no deadline. Players will not know when to play it. Add a day on Rounds & formats — you can still do this after launch.",
    );
    expect(r.warnings).toContain(
      "Round 1 and Round 2 have no tee sheet saved, so nobody has a time to turn up for. Draw one on Tee sheet — you can still do this after launch.",
    );
  });

  it("warns about players left off a side once sides exist", () => {
    const r = launchOf({ teams: { needed: true, sides: 2, unsided: 1 } });
    expect(r.refusal).toBeNull();
    expect(r.warnings).toEqual([
      "1 player is not on a side yet. They have no side to score for. Put them on one on Teams & pairs — after launch, this needs Unlock first.",
    ]);
  });

  it("names every screen it sends the organizer to by the sidebar's own name, and links to it", () => {
    const flow = setupFlow({ ...READY, moneyAnswered: false, groups: 0, named: false, rounds: [medal({ teeSheetSaved: false })] }, screenName);
    for (const href of ["/event", "/grouping", "/prizes", "/foursomes"]) {
      const w = flow.launch.warnings.find((x) => x.href === href);
      expect(w, `no warning links ${href}`).toBeDefined();
      expect(w!.fix).toContain(screenName(href));
    }
  });
});

describe("the dialog's three rows", () => {
  const four = () =>
    setupFlow({ ...READY, moneyAnswered: false, groups: 0, named: false, rounds: [medal({ teeSheetSaved: false })] }, screenName).launch.warnings;

  it("keeps three warnings as three rows, nothing folded", () => {
    const three = four().slice(1);
    expect(launchRows(three)).toEqual({ rows: three, alsoOpen: [] });
  });

  it("past three, the third row names the rest inline, each linked to its own screen", () => {
    const all = four();
    expect(all.length).toBe(4);
    const { rows, alsoOpen } = launchRows(all);
    expect(rows).toEqual(all.slice(0, 2));
    // Folded, not dropped: every remaining warning keeps its own screen and link.
    expect(alsoOpen.map((w) => [w.screen, w.href])).toEqual([
      [screenName("/prizes"), "/prizes"],
      [screenName("/foursomes"), "/foursomes"],
    ]);
    expect([...rows, ...alsoOpen]).toEqual(all);
  });
});
