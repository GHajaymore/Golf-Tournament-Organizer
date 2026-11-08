import { describe, it, expect } from "vitest";
import { courseDayOf, type CourseDay } from "../timeline-step";
import { DATES_PASSED_UNLAUNCHED, statusCardOf, tournamentStatus, type Family, type TournamentFacts } from "../tournament-status";
import { FAMILIES, FAMILY_FIXTURES, completed, facts, launched, playedOut, round } from "./tournament-facts-fixtures";

/**
 * THE COURSE DAY TIMELINE READS THE MACHINE (state machine PR 5c, J16; owner ruling 3 Nov).
 *
 * Rounds & formats' redesign (`?view=timeline`, switch off) says three things about where a
 * tournament is: its chip, the "Needs you" strip led by the one next thing, and each round's chip.
 * Each is `tournamentStatus(facts)` drawn through `courseDayOf` — so, for every format family at
 * every step, the timeline says what the dashboard's status card says (`statusCardOf`, the card
 * the dashboard draws), and a round's chip is its own step and its first need.
 *
 * The expectations are worked from the panel's tables (proposal 8.2) and the two disagreements
 * the timeline had with them, D7 and D8 — not from `courseDayOf`'s own code.
 */

const day = (f: TournamentFacts): CourseDay => courseDayOf(tournamentStatus(f));
const words = (d: CourseDay) => d.items.map((i) => [i.said, i.rest].filter(Boolean).join(" — "));

/** The four steps, as the fixtures' moves take a tournament through them. */
const STEPS = {
  "setting-up": (f: TournamentFacts) => f,
  live: launched,
  "play-over": playedOut,
  completed,
} as const;

/** Each family's first round's chip at each step — from the panel's table, by hand. */
const FIRST_ROUND_CHIP: Record<Family, Record<keyof typeof STEPS, string>> = {
  stroke: { "setting-up": "Set up", live: "Upcoming", "play-over": "Played", completed: "Played" },
  stableford: { "setting-up": "Set up", live: "Upcoming", "play-over": "Played", completed: "Played" },
  match: { "setting-up": "Set up", live: "Upcoming", "play-over": "Played", completed: "Played" },
  roundRobinFlights: { "setting-up": "Set up", live: "Upcoming", "play-over": "Played", completed: "Played" },
  // A knockout's Bracket Stage is never closed: once its Final is decided it is played, not "In play" (D3).
  knockout: { "setting-up": "Set up", live: "Upcoming", "play-over": "Played", completed: "Played" },
  flightedKnockout: { "setting-up": "Set up", live: "Upcoming", "play-over": "Played", completed: "Played" },
  teamCup: { "setting-up": "Set up", live: "Upcoming", "play-over": "Played", completed: "Played" },
  league: { "setting-up": "Set up", live: "Upcoming", "play-over": "Played", completed: "Played" },
  // A casual round is created live and is never "play over" (it is kept or deleted).
  casual: { "setting-up": "Upcoming", live: "Upcoming", "play-over": "Played", completed: "Played" },
};

const EXPECTED_STEP: Record<keyof typeof STEPS, string> = {
  "setting-up": "setting-up",
  live: "live",
  "play-over": "play-over",
  completed: "completed",
};

describe("every family, every step: the timeline says what the dashboard's status card says", () => {
  for (const family of FAMILIES) {
    for (const [stepName, move] of Object.entries(STEPS) as [keyof typeof STEPS, (f: TournamentFacts) => TournamentFacts][]) {
      it(`${family} — ${stepName}`, () => {
        const f = move(FAMILY_FIXTURES[family]());
        const card = statusCardOf(f);
        const d = day(f);

        // The step: the casual round is created live and never play over; every other family walks all four.
        const expected =
          family === "casual" ? (stepName === "completed" ? "completed" : "live") : EXPECTED_STEP[stepName];
        expect(d.step.step).toBe(expected);
        // The chip, its tone and its second line are the dashboard card's, word for word.
        expect(d.step.chip).toBe(card.chip);
        expect(d.step.tag).toBe(card.tag);
        expect(d.step.chipDetail).toBe(card.chipDetail);
        if (expected === "play-over") expect(d.step.chipDetail).toMatch(/results not released$/);

        // The lead is the card's one next action, refused in place exactly when the card refuses it —
        // except a completed tournament, whose Reopen is a remedy and not something that needs you.
        if (!card.nextAction || expected === "completed") {
          expect(d.lead).toBeNull();
        } else {
          expect(d.lead).not.toBeNull();
          expect(d.lead!.label).toBe(card.nextAction.label);
          expect(d.lead!.enabled).toBe(card.nextAction.enabled);
          expect(d.lead!.disabledBecause).toBe(card.nextAction.disabledBecause);
        }

        // Each round's chip, from the round's own step.
        const first = tournamentStatus(f).rounds[0];
        expect(d.rounds[first.id]?.chip, `${family} ${stepName}`).toBe(FIRST_ROUND_CHIP[family][stepName]);
        // A completed tournament needs nothing.
        if (expected === "completed") expect(d.items).toEqual([]);
      });
    }
  }

  it("CONTROL: the families and steps above are all of them", () => {
    expect(FAMILIES).toHaveLength(9);
    expect(Object.keys(STEPS)).toEqual(["setting-up", "live", "play-over", "completed"]);
  });
});

describe("dates passed and never launched", () => {
  it("is Setting up on the chip, and the machine's own warning is a line in the strip", () => {
    const f = { ...FAMILY_FIXTURES.stroke(), startOn: "2026-10-01", endOn: "2026-10-02", today: "2026-11-03" };
    const d = day(f);
    expect(d.step.step).toBe("setting-up");
    expect(d.step.chip).toBe(statusCardOf(f).chip);
    expect(d.step.datesPassed).toBe(true);
    const line = d.items.find((i) => i.rest === DATES_PASSED_UNLAUNCHED);
    expect(line, words(d).join("\n")).toBeDefined();
    expect(line!.action).toEqual({ kind: "link", href: "/event", says: "Launch it or change its dates on Tournament details" });
    // Launch itself is still the lead: passed dates warn, they do not refuse.
    expect(d.lead).toMatchObject({ label: "Launch tournament", enabled: true });
  });

  it("CONTROL: a tournament whose dates are ahead says nothing of the kind", () => {
    const d = day(FAMILY_FIXTURES.stroke());
    expect(d.step.datesPassed).toBe(false);
    expect(d.items.some((i) => i.rest === DATES_PASSED_UNLAUNCHED)).toBe(false);
  });
});

describe("the strip is the machine's list — what launch refuses and its dialog warns (D7)", () => {
  it("a one-round medal with no day is not told it has no date: its day is the tournament's dates", () => {
    const d = day(facts({ rounds: [round({ id: "r1", position: 0, scheduled: false })] }));
    expect(words(d).filter((w) => /no date/.test(w))).toEqual([]);
  });

  it("two rounds, the second undated: one line for it, which does not hold launch", () => {
    const d = day(facts({ rounds: [round({ id: "r1", position: 0 }), round({ id: "r2", position: 1, scheduled: false })] }));
    const line = d.items.find((i) => i.said === "Round 2 has no date");
    expect(line).toMatchObject({ rest: "players cannot see when they play.", holds: false, action: { kind: "round", roundId: "r2", says: "Open Round 2" } });
    expect(d.lead).toMatchObject({ label: "Launch tournament", enabled: true });
    expect(d.rounds.r2.chip).toBe("No date");
  });

  it("tee times: asked of a stroke round once somebody has entered, never of a round robin", () => {
    const medal = day(facts({ rounds: [round({ id: "r1", position: 0, teeSheetSaved: false })] }));
    expect(medal.items.find((i) => i.said === "Round 1 has no tee times")).toMatchObject({
      action: { kind: "link", href: "/foursomes?round=r1", says: "Tee sheet" },
      holds: false,
    });
    // The launch dialog's "no tee sheet" warning is that line, so it is not said a second time.
    expect(words(medal).filter((w) => /tee sheet saved/.test(w))).toEqual([]);
    const empty = day(facts({ confirmed: 0, rounds: [round({ id: "r1", position: 0, teeSheetSaved: false })] }));
    expect(empty.items.some((i) => /tee times/.test(i.said))).toBe(false);
    const rr = day(FAMILY_FIXTURES.roundRobinFlights());
    expect(rr.items.some((i) => /tee times/.test(i.said))).toBe(false);
  });

  it("a league: only the next unplayed week needs a day, and it holds; the later weeks are ONE line (J08)", () => {
    const base = FAMILY_FIXTURES.league();
    const f = { ...base, rounds: base.rounds.map((r) => ({ ...r, scheduled: false })) };
    const d = day(f);
    // Launch is refused for the next week, with the machine's sentence; the way out opens that week here.
    expect(d.lead).toMatchObject({ label: "Launch tournament", enabled: false, wayOut: { kind: "round", roundId: "w1", says: "Open Round 1" } });
    expect(d.lead!.disabledBecause).toMatch(/Round 1 has no day and no deadline/);
    expect(tournamentStatus(f).rounds[0].needs).toEqual([
      { key: "date", missing: "has no day and no deadline", consequence: "nobody knows when to play it", holds: true, fix: "round" },
    ]);
    // So the strip has no line per week at all: the lead says the next week, one warning the rest.
    expect(d.items.filter((i) => /has no day|has no date/.test(i.said))).toEqual([]);
    expect(tournamentStatus(f).rounds.slice(1).flatMap((r) => r.needs)).toEqual([]);
    expect(d.rounds.w2.chip).toBe("Set up");

    // The next week dated: nothing holds, and the later weeks are the dialog's ONE warning, by name.
    const next = { ...f, rounds: f.rounds.map((r, i) => ({ ...r, scheduled: i === 0 })) };
    const d2 = day(next);
    expect(d2.lead).toMatchObject({ label: "Launch tournament", enabled: true });
    expect(d2.items.filter((i) => /has no day|has no date/.test(i.said))).toEqual([]);
    const later = d2.items.filter((i) => /Round 2 and Round 3 have no day or deadline yet/.test(i.rest));
    expect(later, words(d2).join("\n")).toHaveLength(1);
    // Fixed on this screen, so it opens nothing elsewhere.
    expect(later[0].action).toBeNull();
  });

  it("a round with no course card: the launch refusal leads, its way out opens that round, and its line is not said twice", () => {
    const f = { ...FAMILY_FIXTURES.stroke(), missingCards: [{ stageId: "r1", label: "Round 1", course: "Invented Links" }] };
    const st = tournamentStatus(f);
    const d = courseDayOf(st);
    expect(d.lead).toMatchObject({ enabled: false, disabledBecause: st.refusals.launch, wayOut: { kind: "round", roundId: "r1", says: "Open Round 1" } });
    expect(d.lead!.disabledBecause).toMatch(/course card/);
    expect(d.items.some((i) => i.said === "Round 1 has no course card")).toBe(false);
    expect(d.rounds.r1).toMatchObject({ chip: "No course card", standing: "setup" });
  });

  it("a round robin, flights made, no pairings: the way out opens the round with Generate on it, and its line is not said twice", () => {
    const f = FAMILY_FIXTURES.roundRobinFlights();
    f.rounds = [{ ...f.rounds[0], matches: 0 }];
    const st = tournamentStatus(f);
    const d = courseDayOf(st);
    // The machine's way out is Rounds & formats (PR 5c review), so here it is the round itself.
    expect(st.nextAction?.wayOut?.href).toBe("/stages");
    expect(d.lead).toMatchObject({ enabled: false, wayOut: { kind: "round", roundId: "r1", says: "Open Round 1" } });
    expect(d.lead!.disabledBecause).toMatch(/Generate them on Rounds & formats/);
    expect(st.rounds[0].needs.map((n) => n.key)).toEqual(["draw"]);
    expect(d.items.some((i) => i.key === "r1-draw"), words(d).join("\n")).toBe(false);
    // Nor is Flights listed as a step to open: it holds nothing.
    expect(d.items.some((i) => i.said === "Flights")).toBe(false);
    expect(d.rounds.r1.chip).toBe("Not drawn yet");
  });

  it("no dates: the refusal's way out is Tournament details, and that step is not listed again", () => {
    const d = day({ ...FAMILY_FIXTURES.stroke(), dated: false });
    expect(d.lead).toMatchObject({ enabled: false, wayOut: { kind: "link", href: "/event", says: "Open Tournament details" } });
    expect(d.items.some((i) => i.said === "Tournament details")).toBe(false);
  });

  it("in setup order: a step that holds on another screen, then each round, then the dialog's warnings", () => {
    const f = facts({
      dated: false,
      confirmed: 12,
      moneyAnswered: false,
      teams: { needed: true, sides: 0, unsided: 12 },
      rounds: [round({ id: "r1", position: 0, format: "Four-Ball" }), round({ id: "r2", position: 1, scheduled: false, teeSheetSaved: false })],
    });
    const d = day(f);
    const order = d.items.map((i) => i.key);
    const teams = order.indexOf("step-teams");
    const r2 = order.indexOf("r2-date");
    const money = d.items.findIndex((i) => /money/.test(i.rest));
    expect(r2, words(d).join("\n")).toBeGreaterThanOrEqual(0);
    expect(teams).toBeGreaterThan(r2); // Rounds & formats comes before Teams & pairs in the setup flow
    expect(money).toBeGreaterThan(teams);
    expect(order.indexOf("r2-teeSheet")).toBe(r2 + 1); // inside a round: the date, then the tee times
  });
});

describe("a round's chip is the round's own step (D8), never its date against today", () => {
  it("live, an undated round with nothing in yet is Upcoming, not In play", () => {
    const d = day(launched(facts({ rounds: [round({ id: "r1", position: 0, scheduled: false })] })));
    expect(d.rounds.r1).toEqual({ chip: "Upcoming", tone: "neutral", standing: "upcoming" });
  });

  it("a round with a result is In play, and the spine rings it", () => {
    const d = day(launched(facts({ rounds: [round({ id: "r1", position: 0, hasResult: true }), round({ id: "r2", position: 1 })] })));
    expect(d.rounds.r1).toEqual({ chip: "In play", tone: "accent", standing: "active" });
    expect(d.rounds.r2.chip).toBe("Upcoming");
  });

  it("play over with a round never played: that round is Not played — never No date or Upcoming (PM, PR 5c review)", () => {
    // A cup decided after its first session: play is over, the second session was never played.
    const base = FAMILY_FIXTURES.teamCup();
    const f = launched({
      ...base,
      cupDecided: true,
      rounds: [{ ...base.rounds[0], hasResult: true, closed: true }, { ...base.rounds[1], scheduled: false }],
    });
    const st = tournamentStatus(f);
    expect(st.step).toBe("play-over");
    expect(st.rounds[1]).toMatchObject({ state: "not-started", needs: [] });
    const d = courseDayOf(st);
    expect(d.rounds.r2).toEqual({ chip: "Not played", tone: "neutral", standing: "played" });
    expect(d.rounds.r1.chip).toBe("Played");
    // And the strip asks nothing of it: play is over.
    expect(d.items.some((i) => i.round === "Round 2")).toBe(false);
    // Completed, the same.
    expect(courseDayOf(tournamentStatus({ ...f, status: "completed" })).rounds.r2.chip).toBe("Not played");
  });

  it("results in before launch: the chip says so, the round is in play, and Launch is still the lead", () => {
    const f = facts({ rounds: [round({ id: "r1", position: 0, hasResult: true })] });
    const d = day(f);
    expect(d.step.chip).toBe("Setting up · results in");
    expect(d.rounds.r1.chip).toBe("In play");
    expect(d.lead).toMatchObject({ label: "Launch tournament" });
  });
});

describe("live: the lead is the machine's next action, done on its round here", () => {
  it("a round robin's second round owed its pairings: Generate opens that round, and its line is not repeated", () => {
    const f = launched(
      facts({
        confirmed: 8,
        rounds: [
          round({ id: "r1", position: 0, type: "Round Robin", format: "Match Play", drawsPairings: true, matches: 12, hasResult: true, closed: true, teeSheetSaved: null }),
          round({ id: "r2", position: 1, type: "Round Robin", format: "Match Play", drawsPairings: true, matches: 0, teeSheetSaved: null }),
        ],
      }),
    );
    const d = day(f);
    expect(d.lead).toEqual({
      label: "Generate Round 2 pairings",
      enabled: true,
      action: { kind: "round", roundId: "r2", says: "Generate Round 2 pairings" },
      disabledBecause: null,
      wayOut: null,
    });
    expect(d.items.some((i) => i.key === "r2-draw")).toBe(false);
    expect(d.rounds.r2.chip).toBe("Not drawn yet");
  });

  it("a live league: only the NEXT unplayed week needs a day — never the weeks after it (J08)", () => {
    const base = FAMILY_FIXTURES.league();
    const f = launched({
      ...base,
      rounds: base.rounds.map((r, i) => ({ ...r, scheduled: i === 0, hasResult: i === 0, closed: i === 0 })),
    });
    const st = tournamentStatus(f);
    expect(st.rounds.map((r) => r.needs.filter((n) => n.key === "date").length)).toEqual([0, 1, 0]);
    // Live, it holds nothing (launch is past); it is the next action, done on that week here.
    expect(st.rounds[1].needs[0]).toMatchObject({ key: "date", holds: false, missing: "has no day and no deadline" });
    const d = courseDayOf(st);
    expect(d.lead).toMatchObject({ label: "Set Round 2’s day", enabled: true, action: { kind: "round", roundId: "w2" } });
    expect(d.items.filter((i) => /has no day/.test(i.said))).toEqual([]);
    expect(d.rounds.w2.chip).toBe("No date");
    expect(d.rounds.w3.chip).toBe("Upcoming");
  });

  it("a medal with nothing scored: Complete is refused in place, with the machine's way out", () => {
    const f = launched(FAMILY_FIXTURES.stroke());
    const st = tournamentStatus(f);
    const d = courseDayOf(st);
    expect(d.lead).toMatchObject({ label: "Complete tournament", enabled: false, disabledBecause: st.nextAction!.disabledBecause });
    expect(d.lead!.wayOut).toEqual({ kind: "link", ...st.nextAction!.wayOut! });
  });
});
