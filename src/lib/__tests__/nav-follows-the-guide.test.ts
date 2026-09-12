import { describe, it, expect } from "vitest";
import { navForRole } from "../nav";
import { setupFlow, type SetupFacts } from "../domain/setup-flow";

/**
 * THE SIDEBAR LISTS THE SET-UP SCREENS IN THE ORDER THE GUIDE WALKS THEM.
 *
 * `setup-flow.ts` picks the order and says why it is a product decision rather
 * than a detail: "Deciding the field before deciding whether it is a medal or
 * a knockout is the wrong way round, and it is the way round that had somebody
 * adding players before discovering the format was not the one they wanted."
 *
 * It also says what the guide is FOR: so that "the app cannot tell an organizer
 * one order in the rail and a different one in the buttons".
 *
 * The sidebar was telling them a third order. It listed Registration & field
 * above Rounds & formats — exactly the sequence that file rejects — so an
 * organizer following the rail went event → rounds → field while the list
 * beside it read event → field → rounds. Nothing reconciled the two, and the
 * sidebar is the one most people use once they have set up their second
 * tournament.
 *
 * Both directions are pinned: the rail cannot be reordered without the sidebar
 * following, and the sidebar cannot be reordered at all without this going red.
 */

/** A tournament with nothing done yet: every step is ahead, in order. */
const NOTHING_DONE: SetupFacts = {
  confirmed: 0,
  stages: 0,
  groups: 0,
  matches: 0,
  drawsPairings: false,
  named: false,
  dated: false,
  venued: false,
  launched: false,
};

const flowHrefs = () => setupFlow(NOTHING_DONE, (href) => href).steps.map((s) => s.href);

/** Every Set-up item the sidebar shows an organizer, in the order shown. */
const sidebarSetupHrefs = () => {
  const nav = navForRole("admin");
  const section = nav.find((s) => s.label === "Set up");
  expect(section, "the Set up section is gone from the sidebar").toBeTruthy();
  return section!.items.map((i) => i.href);
};

describe("the sidebar and the setup guide agree about order", () => {
  it("lists the guided steps in the guide's own sequence", () => {
    /**
     * A SUBSEQUENCE, not an equality. The sidebar carries screens the guide
     * does not — Flights, Teams & pairs, Access & staff are reachable whenever
     * they are wanted and have no place in a first-run sequence — so what has
     * to hold is that the ones the guide DOES order appear in that order.
     */
    const guide = flowHrefs();
    const sidebar = sidebarSetupHrefs();
    const guided = sidebar.filter((h) => guide.includes(h));
    expect(guided, `sidebar: ${sidebar.join(" → ")}`).toEqual(guide.filter((h) => sidebar.includes(h)));
  });

  it("puts what is being played before who is playing it", () => {
    /**
     * Named separately from the subsequence check above, because this is the
     * actual product decision and the one that was wrong. If the guide is ever
     * reordered so the field comes first, this goes red and somebody has to
     * revisit `setup-flow.ts`'s reasoning rather than quietly following it.
     */
    const sidebar = sidebarSetupHrefs();
    expect(sidebar.indexOf("/stages"), "Rounds & formats is missing").toBeGreaterThan(-1);
    expect(sidebar.indexOf("/registration"), "Registration & field is missing").toBeGreaterThan(-1);
    expect(sidebar.indexOf("/stages")).toBeLessThan(sidebar.indexOf("/registration"));

    const guide = flowHrefs();
    expect(guide.indexOf("/stages")).toBeLessThan(guide.indexOf("/registration"));
  });

  it("starts both with the tournament itself", () => {
    // Nothing downstream can be decided about a tournament that is a name and
    // nothing else — `setup-flow.ts` says so of its own first step.
    expect(flowHrefs()[0]).toBe("/event");
    expect(sidebarSetupHrefs()[0]).toBe("/event");
  });
});
