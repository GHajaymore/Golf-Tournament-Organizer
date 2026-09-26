import { describe, it, expect } from "vitest";
import {
  setupFlow,
  positionOf,
  canAdvance,
  roundIsScheduled,
  type SetupFacts,
  type SetupRound,
} from "../setup-flow";
import { screenName } from "@/lib/nav";
import { launchRefusal } from "../phase-gate";

/**
 * ONE ROUND, FULLY SET UP — a round robin with a day and its fixtures drawn.
 *
 * The default is the DEMANDING type deliberately. `drawsPairings: true` is the
 * case both round tests actually bite on, so a fixture built by overriding
 * this one starts from the round that can fail and is relaxed on purpose,
 * rather than starting from a medal that passes the fixture test for free and
 * hiding which assertions are doing work.
 */
const round = (over: Partial<SetupRound> = {}): SetupRound => ({
  label: "Round 1",
  drawsPairings: true,
  scheduled: true,
  cutFed: false,
  matches: 6,
  ...over,
});

/** Nothing done — a tournament the moment it is created. */
const BLANK: SetupFacts = {
  confirmed: 0,
  rounds: [],
  groups: 0,
  named: false,
  dated: false,
  venued: false,
  // Nobody has been asked about money either — not the tournament and not the
  // club it belongs to — so the last step is genuinely outstanding rather than
  // inherited and already ticked.
  moneyAnswered: false,
  launched: false,
};

const flowOf = (over: Partial<SetupFacts> = {}) => setupFlow({ ...BLANK, ...over }, screenName);

describe("the order setup is guided in", () => {
  it("asks what it is, what is played, who plays, how they divide, then the money", () => {
    // The order IS the product decision, so it is asserted rather than left to
    // whatever the array happens to contain. It is deliberately not the
    // checklist's order: deciding the field before deciding whether this is a
    // medal or a knockout is the way round that had somebody adding players
    // before finding out the format was wrong.
    expect(flowOf().steps.map((s) => s.href)).toEqual([
      "/event",
      "/stages",
      "/registration",
      "/grouping",
      // And the money last, because it is the only one of the five that is not
      // a precondition of playing golf — see the step.
      "/prizes",
    ]);
  });

  it("calls each screen what the sidebar calls it", () => {
    // Read from the nav rather than written out again — the same rule that
    // produced a checklist row reading "Rounds & format" for a screen called
    // "Rounds & formats".
    const labels = flowOf().steps.map((s) => s.label);
    expect(labels).toEqual([
      screenName("/event"),
      screenName("/stages"),
      screenName("/registration"),
      screenName("/grouping"),
      screenName("/prizes"),
    ]);
    expect(labels).not.toContain("/event");
  });
});

describe("the money step", () => {
  /**
   * THE QUESTION THE GUIDE NEVER ASKED, AND THE CLUB CHAIN PROMISED.
   *
   * "Decide how money works" is a club step, and its blurb ends "Changeable
   * per tournament later" — without saying where. The answer was the last card
   * on the Prizes screen, below the settle-up it governs, so keeping that
   * promise meant scrolling past everything the decision decides.
   */
  const allButMoney = { named: true, venued: true, rounds: [round()], confirmed: 2, groups: 1 };

  it("is the last thing asked, after the golf is arranged", () => {
    const flow = flowOf(allButMoney);
    expect(flow.current?.href).toBe("/prizes");
    expect(flow.doneCount).toBe(4);
    expect(flow.complete).toBe(false);
  });

  it("is finished by one answer, so the guide cannot be pinned on it", () => {
    /**
     * THE FAILURE MODE THIS IS GUARDING. `readyToLaunch` requires every step,
     * so a step that cannot be finished holds the one banner that says setup
     * is done and the field still cannot see any of it — which is exactly what
     * `drawsPairings` is a scar from. This step is satisfied by a single
     * choice on a screen that is always reachable.
     */
    const answered = flowOf({ ...allButMoney, moneyAnswered: true });
    expect(answered.complete).toBe(true);
    expect(answered.readyToLaunch).toBe(true);
  });

  it("says what is outstanding in words, not a blank", () => {
    // The rail prints `missing` against the current step and nothing else, so
    // an empty string here is a step that asks for something and does not say
    // what.
    const step = flowOf(allButMoney).current!;
    expect(step.missing.trim().length).toBeGreaterThan(0);
    expect(step.question).toMatch(/money/i);
  });

  it("does not hold up the four steps that are actually golf", () => {
    /**
     * The control. Without it, a change that made the money step block its
     * predecessors — or that reordered it to the front — would pass every
     * assertion above while stopping an organizer entering a field until they
     * had answered a question about entry fees.
     */
    const flow = flowOf(allButMoney);
    for (const href of ["/event", "/stages", "/registration", "/grouping"]) {
      expect(flow.steps.find((s) => s.href === href)!.done, href).toBe(true);
    }
  });
});

describe("what counts as done", () => {
  it("needs a name and either a date or a venue — never both", () => {
    // A league that plays somewhere new every week has no venue; a club still
    // arguing about the date has no date. Demanding both leaves each of them
    // stuck on step one.
    expect(flowOf({ named: true }).steps[0].done).toBe(false);
    expect(flowOf({ named: true, dated: true }).steps[0].done).toBe(true);
    expect(flowOf({ named: true, venued: true }).steps[0].done).toBe(true);
    // And a name is not optional: a date with no name is a diary entry.
    expect(flowOf({ dated: true, venued: true }).steps[0].done).toBe(false);
  });

  it("needs flights AND a schedule, not just flights", () => {
    // The one that would pass on shape alone. Generating produces both, but
    // flights built and then left is a tournament with groups, no fixtures,
    // and nothing to score — and it reads as finished.
    const flightsOnly = flowOf({ named: true, dated: true, rounds: [round({ matches: 0 })], confirmed: 4, groups: 1 });
    expect(flightsOnly.steps[3].done).toBe(false);
    expect(flightsOnly.steps[3].missing).toMatch(/no pairings/i);

    const drawn = flowOf({ named: true, dated: true, rounds: [round()], confirmed: 4, groups: 1 });
    expect(drawn.steps[3].done).toBe(true);
    // NOT complete: the money step is still outstanding. Said here rather than
    // quietly dropped, because "the draw is finished" and "setup is finished"
    // stopped being the same sentence the moment a fifth step was added.
    expect(drawn.complete).toBe(false);
    const andPaid = { named: true, dated: true, rounds: [round()], confirmed: 4, groups: 1, moneyAnswered: true };
    expect(flowOf(andPaid).complete).toBe(true);
  });

  it("counts what is finished rather than how far along you are", () => {
    expect(flowOf().doneCount).toBe(0);
    expect(flowOf({ named: true, dated: true }).doneCount).toBe(1);
    expect(flowOf({ named: true, dated: true, rounds: [round()] }).doneCount).toBe(2);
  });
});

describe("where the guide points", () => {
  it("points at the FIRST gap, not past it", () => {
    /**
     * The case that separates a guide from a counter. Somebody who reaches
     * Rounds first — which is where a newly created tournament already has a
     * round — has step 2 done and step 1 not. Pointing at "the one after the
     * last finished" would send them to Registration and past the gap they
     * left, which is the one thing a guide must never do.
     */
    const jumped = flowOf({ rounds: [round()] });
    expect(jumped.steps[1].done).toBe(true);
    expect(jumped.current?.href).toBe("/event");
    expect(jumped.current?.href).not.toBe("/registration");
  });

  it("has no current step once everything is done", () => {
    const done = flowOf({ named: true, venued: true, rounds: [round()], confirmed: 2, groups: 1, moneyAnswered: true });
    expect(done.complete).toBe(true);
    expect(done.current).toBeNull();
  });

  it("marks exactly one step as current", () => {
    const states = flowOf({ named: true, dated: true }).steps.map((s) => s.state);
    expect(states.filter((s) => s === "current")).toHaveLength(1);
    expect(states).toEqual(["done", "current", "todo", "todo", "todo"]);
  });
});

describe("moving between steps", () => {
  it("knows what is either side of each screen", () => {
    const flow = flowOf();
    expect(positionOf(flow, "/event").back).toBeNull();
    expect(positionOf(flow, "/event").next?.href).toBe("/stages");
    expect(positionOf(flow, "/registration").back?.href).toBe("/stages");
    expect(positionOf(flow, "/registration").next?.href).toBe("/grouping");
    expect(positionOf(flow, "/grouping").next?.href).toBe("/prizes");
    expect(positionOf(flow, "/prizes").back?.href).toBe("/grouping");
    expect(positionOf(flow, "/prizes").next).toBeNull();
  });

  it("says nothing about a screen that is not part of setup", () => {
    // The rail renders on the setup screens; asked about any other one it
    // must decline rather than guess an index.
    const at = positionOf(flowOf(), "/leaderboard");
    expect(at.step).toBeNull();
    expect(at.back).toBeNull();
    expect(at.next).toBeNull();
  });

  it("waits for the current step to be finished before offering the next", () => {
    const flow = flowOf({ named: true });
    const here = positionOf(flow, "/event").step;
    expect(canAdvance(here)).toBe(false);

    const ready = positionOf(flowOf({ named: true, dated: true }), "/event").step;
    expect(canAdvance(ready)).toBe(true);
  });

  it("never blocks going back to a step that is already finished", () => {
    // Revisiting Tournament details to change the date is exactly what "back"
    // is for, and a guide that argues about it is worse than no guide.
    const flow = flowOf({ named: true, dated: true, rounds: [round()] });
    const finished = positionOf(flow, "/event").step;
    expect(finished?.done).toBe(true);
    expect(canAdvance(finished)).toBe(true);
  });

  it("advances freely from a screen the flow does not cover", () => {
    expect(canAdvance(null)).toBe(true);
  });
});

describe("the hand-off from setting up to running", () => {
  const finished = { named: true, venued: true, rounds: [round()], confirmed: 2, groups: 1, moneyAnswered: true };

  it("says setup is done while the field still cannot see any of it", () => {
    /**
     * The gap this closes. The rail guided an organizer through four steps and
     * then vanished at the exact moment the tournament became real — nothing
     * said they were finished, and nothing said that until it is launched
     * nobody in the field can see their schedule, their card or the
     * leaderboard. The existing warning about that fires only once a SCORE has
     * been entered, which is the morning of.
     */
    const ready = flowOf({ ...finished, launched: false });
    expect(ready.complete).toBe(true);
    expect(ready.readyToLaunch).toBe(true);
  });

  it("clears itself the moment the tournament is launched", () => {
    // What makes it worth showing at all: it is true for the few minutes
    // between finishing setup and launching, and false forever after. A
    // banner that stays is furniture.
    const live = flowOf({ ...finished, launched: true });
    expect(live.complete).toBe(true);
    expect(live.readyToLaunch).toBe(false);
  });

  it("never offers a launch before setup is finished", () => {
    // Launching hands out player access and locks configuration. Offering it
    // over a tournament with no field would be offering to publish an empty
    // one.
    const halfway = flowOf({ named: true, dated: true, rounds: [round()], launched: false });
    expect(halfway.complete).toBe(false);
    expect(halfway.readyToLaunch).toBe(false);
  });

  it("says what is still stopping the launch, in the launch gate's words", () => {
    /**
     * Found 2026-09-26 running a Stableford from scratch: every step done —
     * the details step takes a venue in place of a date, deliberately — and the
     * rail said "take it live" over a Launch button the dashboard disabled for
     * want of a date. `finished` above is that tournament: a venue, no date.
     */
    const ready = flowOf({ ...finished, launched: false });
    expect(ready.launchBlocked).toBe(
      launchRefusal({ playingRounds: 1, confirmed: 2, dated: false }),
    );
    expect(ready.launchBlocked).toContain("no dates");
  });

  it("says nothing is left once it has a date (control)", () => {
    expect(flowOf({ ...finished, dated: true, launched: false }).launchBlocked).toBeNull();
  });

  it("says nothing once it has launched", () => {
    expect(flowOf({ ...finished, launched: true }).launchBlocked).toBeNull();
  });
});

describe("a tournament that draws no pairings", () => {
  /**
   * A medal, and the case the guide could not finish.
   *
   * The last step tests for FIXTURES as well as flights, and the reason is
   * sound where it applies: on a round robin, generating produces both, and a
   * flight built and then left is a tournament with groups and nothing to
   * score. A Stroke Play Round draws no pairings at all — nobody is playing
   * anybody — so that test was waiting for something that never happens.
   *
   * Read off a real one on 2026-09-09: four players entered, two flights
   * generated, and the screen itself printing "Flights are made, but no
   * pairings are drawn" while the rail above it stayed on "4 TO DO".
   */
  const medal = {
    named: true,
    venued: true,
    // One round, so the day/deadline test does not apply — see the `stages`
    // step. This block is about the FIXTURES half of the flights step and
    // nothing else, so the round is given no schedule on purpose: if the
    // single-round exemption were ever dropped, these assertions would go red
    // for a reason that has nothing to do with what they are testing, which is
    // exactly the signal wanted.
    rounds: [round({ drawsPairings: false, scheduled: false, matches: 0 })],
    confirmed: 4,
    groups: 2,
    // Answered, because this block is about the FIXTURES half of the flights
    // step. Leaving the money outstanding would have every assertion in it
    // pass or fail for a reason the block is not about.
    moneyAnswered: true,
    launched: false,
  };

  it("finishes setup on flights alone", () => {
    const flow = flowOf(medal);
    const grouping = flow.steps.find((s) => s.href === "/grouping")!;
    expect(grouping.done, "flights are all this tournament has to divide").toBe(true);
    expect(flow.complete).toBe(true);
    expect(flow.doneCount).toBe(5);
  });

  it("and is then told the field still cannot see it", () => {
    /**
     * THE PART THAT MATTERS, and the reason this is not a cosmetic counter.
     *
     * `readyToLaunch` requires `complete`, so while the last step could never
     * finish, the one banner that says setup is done and the tournament is
     * still invisible never appeared on a medal at all — and the other
     * warning about an unlaunched tournament does not fire until somebody
     * enters a score, which is a day too late.
     */
    expect(flowOf(medal).readyToLaunch).toBe(true);
    expect(flowOf({ ...medal, launched: true }).readyToLaunch).toBe(false);
  });

  it("still asks for the flights themselves", () => {
    // Not "skip the step" — the field must still be divided. Only the fixture
    // half is dropped, and only where there are no fixtures.
    const noFlights = flowOf({ ...medal, groups: 0 });
    expect(noFlights.steps.find((s) => s.href === "/grouping")!.done).toBe(false);
    expect(noFlights.complete).toBe(false);
  });

  it("and a round robin is unchanged", () => {
    /**
     * THE ASSERTION THAT STOPS THIS BECOMING "NEVER ASK FOR FIXTURES".
     *
     * Same facts, one flag flipped. A change that dropped the fixture test
     * for everybody would pass all three tests above and quietly let a round
     * robin with no schedule read as a finished tournament.
     */
    const rr = flowOf({ ...medal, rounds: [round({ scheduled: false, matches: 0 })] });
    expect(rr.steps.find((s) => s.href === "/grouping")!.done).toBe(false);
    expect(rr.complete).toBe(false);
    expect(rr.readyToLaunch).toBe(false);
    expect(flowOf({ ...medal, rounds: [round({ scheduled: false })] }).complete).toBe(true);
  });
});

describe("a round with no day and no deadline", () => {
  /**
   * WHAT "ROUNDS & FORMATS = DONE" USED TO MEAN: one Stage row exists.
   *
   * Found on 2026-09-15 by looking at the screen rather than the tests. The
   * rail read "Rounds & formats DONE" and "Setup is done — all 5 parts" over a
   * four-round tournament dated "May 14–16, 2026" in which Round 1 had a
   * deadline and Rounds 2, 3 and 4 had neither a day nor a deadline. Nothing
   * in the app could say which of the three days any round was played on, and
   * nothing was asking.
   */
  const base = { named: true, dated: true, confirmed: 4, groups: 1, moneyAnswered: true };
  const stagesStep = (over: Partial<SetupFacts>) =>
    flowOf({ ...base, ...over }).steps.find((s) => s.href === "/stages")!;

  it("does not finish the step, where there is more than one round", () => {
    const step = stagesStep({ rounds: [round(), round({ label: "Round 2", scheduled: false })] });
    expect(step.done).toBe(false);
    // And it names the one that is holding it up, rather than saying a round
    // somewhere is unfinished and leaving the organizer to find it.
    expect(step.missing).toContain("Round 2");
    expect(step.missing).toMatch(/day/i);
  });

  it("finishes the step once that round has a day", () => {
    expect(stagesStep({ rounds: [round(), round({ label: "Round 2" })] }).done).toBe(true);
  });

  /**
   * WHAT COUNTS AS "WHEN", asserted where the reading actually happens.
   *
   * This block was first written against `scheduled: true` on the fixture,
   * which is a boolean the test sets itself — so it could not tell a day from
   * a deadline and would have passed just as happily if the deadline half had
   * been deleted. `roundIsScheduled` is the reading, and it is asserted
   * directly; the fixture above only exercises what the step does with the
   * answer.
   */
  it("takes a deadline instead of a day, because a knockout has one and not the other", () => {
    // A fixed-day league PLAYS on Tuesday.
    expect(roundIsScheduled("2026-05-19", "")).toBe(true);
    // A knockout round whose players arrange their own match is played BY a
    // date. Dropping this half would refuse a shape clubs genuinely run.
    expect(roundIsScheduled("", "May 24, 6:00 PM")).toBe(true);
    // Neither is the state the whole step is about.
    expect(roundIsScheduled("", "")).toBe(false);
    // And a stored space is not a day — both columns default to empty, and
    // whitespace is what a cleared input leaves behind.
    expect(roundIsScheduled("  ", " ")).toBe(false);
  });

  it("never asks a one-round tournament, which the event already dated", () => {
    /**
     * THE EXEMPTION, and the reason it is not laziness. Step one asked for a
     * date or a venue; on a tournament with one round, the event's date IS
     * that round's date and asking again is the app forgetting an answer it
     * has — the same reasoning `moneyAnswered` uses for a club's setting.
     *
     * With two rounds the event's date stops being an answer: "May 14–16"
     * says nothing about which of the three days Round 2 is.
     */
    expect(stagesStep({ rounds: [round({ scheduled: false })] }).done).toBe(true);
  });

  it("still refuses a tournament with no rounds at all", () => {
    // The original test, kept: the step is "add a round" first and "say when"
    // second, and a change that only counted schedules would let a tournament
    // with nothing in it read as finished.
    const step = stagesStep({ rounds: [] });
    expect(step.done).toBe(false);
    expect(step.missing).toContain("Add at least one round");
  });
});

describe("a second round with no pairings", () => {
  /**
   * THE SAME DEFECT AS THE COUNT, ONE STEP ALONG.
   *
   * The flights step tested `f.matches > 0` across the whole EVENT, which any
   * one round satisfies on behalf of all of them. So a second round robin
   * with no draw at all passed on the strength of the first round's matches —
   * while the Rounds & formats screen sat there showing that very round a
   * "Not generated yet" chip.
   */
  const base = { named: true, dated: true, confirmed: 4, groups: 2, moneyAnswered: true };
  const groupingStep = (rounds: SetupRound[]) =>
    flowOf({ ...base, rounds }).steps.find((s) => s.href === "/grouping")!;

  it("is not covered by the first round's fixtures", () => {
    const step = groupingStep([round(), round({ label: "Round 2", matches: 0 })]);
    expect(step.done).toBe(false);
    expect(step.missing).toContain("Round 2");
    // And it says where the button is. Generating a later round happens on
    // Rounds & formats, beside the round it builds — not on this step's own
    // screen, which is the one thing a step whose fix is elsewhere must say.
    expect(step.missing).toMatch(/Rounds & formats/);
  });

  it("is satisfied once that round is drawn", () => {
    expect(groupingStep([round(), round({ label: "Round 2" })]).done).toBe(true);
  });

  it("never asks a cut-fed round, which cannot be drawn until it is played into", () => {
    /**
     * THE EXEMPTION THAT KEEPS THIS FROM BECOMING `drawsPairings` AGAIN.
     *
     * A round whose field is the survivors of a cut is drawn from the
     * previous round's standings, and the screen says so in as many words —
     * "run it once this round is complete". Requiring it during setup waits
     * for a tournament to be half played, which is a step that cannot be
     * finished, which is a guide that is pinned for ever.
     */
    const step = groupingStep([round(), round({ label: "Round 2", cutFed: true, matches: 0 })]);
    expect(step.done).toBe(true);
  });

  it("and a medal round is still never asked for a draw at all", () => {
    /**
     * The control against this becoming "every round needs matches". Same two
     * rounds, the second a medal: it draws no pairings by design, so an empty
     * one is finished work rather than outstanding work.
     */
    const step = groupingStep([round(), round({ label: "Round 2", drawsPairings: false, matches: 0 })]);
    expect(step.done).toBe(true);
  });
});
