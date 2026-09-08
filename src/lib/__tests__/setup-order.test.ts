import { describe, it, expect } from "vitest";
import { SETUP_ORDER, bySetupOrder } from "@/lib/domain/setup-flow";
import { setupChecklist, type ChecklistState } from "@/lib/services/checklist";
import { readSource } from "./source";

/**
 * ONE ORDER FOR SETTING A TOURNAMENT UP.
 *
 * The app stated three, and an organizer met all of them:
 *
 *   the rail on every Set-up screen    details -> rounds -> field -> flights
 *   the "Recommended flow" card        field -> flights, then rounds
 *   the dashboard's setup checklist    field -> rounds -> flights
 *
 * Two of those are on `/event` at the same time, one directly under the other,
 * and the third is on the screen an organizer lands on straight after creating
 * a tournament. `setup-flow.ts` had already argued its order was the right one
 * and said in its own comment that the checklist disagreed — the disagreement
 * was known and left standing.
 *
 * Whichever order is right, an app that states three cannot be teaching any of
 * them. This asserts they now agree, and it is a SWEEP of the real lists
 * rather than a restatement of the order, so a fourth list added later is
 * covered the day it appears.
 */

const empty: ChecklistState = {
  confirmed: [],
  waitlist: [],
  stages: [],
  groups: [],
  matches: [],
  accounts: [{}],
};

describe("the setup sequence is stated once", () => {
  it("runs details, then what is played, then who plays it, then the draw", () => {
    /**
     * The product decision, pinned. `setup-flow.ts` explains it: deciding the
     * field before deciding whether it is a medal or a knockout is the way
     * round that "had somebody adding players before discovering the format
     * was not the one they wanted".
     */
    expect(SETUP_ORDER).toEqual(["/event", "/stages", "/registration", "/grouping"]);
  });

  it("orders the dashboard checklist by it", () => {
    // The checklist does not carry a details step, so it is SETUP_ORDER with
    // that one absent — not a different sequence.
    const hrefs = setupChecklist(empty)
      .map((i) => i.href)
      .filter((h) => SETUP_ORDER.includes(h));
    expect(hrefs).toEqual(SETUP_ORDER.filter((h) => h !== "/event"));
  });

  it("keeps the optional steps after the required ones", () => {
    /**
     * `bySetupOrder` sorts anything it does not recognise to the end, which is
     * what keeps "Access & staff" and the branding nudge out of the middle of
     * the sequence. A stable sort, so the tail keeps the order its caller
     * chose rather than being shuffled.
     */
    const items = setupChecklist({ ...empty, branding: { hasLogo: false, hasColours: false } });
    const firstOptional = items.findIndex((i) => i.optional);
    expect(firstOptional).toBeGreaterThan(-1);
    expect(items.slice(firstOptional).every((i) => i.optional)).toBe(true);
  });

  it("leaves an unknown href alone rather than dropping it", () => {
    // Sorting must never lose a row: a step this order has not been told about
    // is still a step somebody has to do.
    const sorted = bySetupOrder([
      { href: "/grouping" },
      { href: "/nowhere" },
      { href: "/event" },
    ]);
    expect(sorted.map((x) => x.href)).toEqual(["/event", "/grouping", "/nowhere"]);
  });

  it("says the same thing in the Recommended flow card", () => {
    /**
     * The card is prose in JSX rather than a list this can import, so it is
     * read as source — and read through `readSource`, because the comment
     * ABOVE it now names the order too and would otherwise satisfy the
     * assertion on its own. See source-guard.test.ts.
     *
     * Asserted as relative position rather than exact strings: the wording of
     * a step is allowed to change, the sequence is not.
     */
    const src = readSource("src", "components", "EventSetupClient.tsx");
    const flow = src.slice(src.indexOf("Recommended flow"));
    const at = (s: string) => flow.indexOf(s);

    expect(at("Tournament details"), "details missing from the card").toBeGreaterThan(-1);
    expect(at("Tournament details")).toBeLessThan(at("Rounds &amp; formats"));
    expect(at("Rounds &amp; formats")).toBeLessThan(at("Registration &amp; field"));
    // And setup still finishes before the tournament is handed to the field.
    expect(at("Registration &amp; field")).toBeLessThan(at("Launch"));
  });
});

describe("the step the dashboard never had", () => {
  /**
   * The dashboard is where a new organizer lands straight after creating a
   * tournament, and its checklist carried four steps: field, rounds, flights,
   * staff. Not one of them said the tournament needed a NAME, a date or a
   * venue — the very first thing the rail asks for, and the thing a freshly
   * created tournament has none of.
   *
   * So the two screens disagreed about how many steps there even are, which is
   * the same disagreement `SETUP_ORDER` fixed for their sequence.
   */
  const withDetails = (done: boolean) =>
    setupChecklist({ ...empty, details: { done, missing: "It still needs a name." } });

  it("leads with tournament details when the caller supplies them", () => {
    expect(withDetails(false)[0].href).toBe("/event");
  });

  it("carries the flow's own words for what is missing", () => {
    // Not recomputed here: `setup-flow.ts` decides whether step one is
    // finished — a name AND either a date or a venue — and a second copy of
    // that reasoning is how the two would come to disagree.
    expect(withDetails(false)[0].detail).toBe("It still needs a name.");
    expect(withDetails(false)[0].done).toBe(false);
  });

  it("says something useful once it is done, rather than nothing", () => {
    expect(withDetails(true)[0].done).toBe(true);
    expect(withDetails(true)[0].detail).toMatch(/date|venue/i);
  });

  it("is absent when the caller does not supply it — existing callers unchanged", () => {
    /**
     * The same contract as `branding`: absent means "don't ask". A caller that
     * has not loaded the flow shows the list it always showed rather than a
     * step it cannot answer.
     */
    expect(setupChecklist(empty).some((i) => i.href === "/event")).toBe(false);
  });

  it("still follows SETUP_ORDER with the step present", () => {
    const hrefs = withDetails(false)
      .map((i) => i.href)
      .filter((h) => SETUP_ORDER.includes(h));
    expect(hrefs).toEqual([...SETUP_ORDER]);
  });
});
