import { describe, it, expect } from "vitest";
import { SETUP_ORDER, bySetupOrder } from "@/lib/domain/setup-flow";
import { allNavItems, TOURNAMENT_ONLY_SCREENS, screenAppliesToMatch } from "@/lib/nav";
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

describe("a screen has one name", () => {
  /**
   * `nav.ts` states the rule and grants exactly one exception — the phone's
   * tab bar, where "Board" and "Scores" exist because a tab is 80px wide — and
   * says of it: "confined to this list so it cannot spread."
   *
   * It had spread. The dashboard's Quick actions carried their own labels:
   * "Players", "Rounds", "Prizes", "Reports", for screens the sidebar calls
   * Registration & field, Rounds & formats, Prizes & payouts and Reports &
   * export. Both names appear on the dashboard AT THE SAME TIME — the setup
   * checklist says one, a tile below says the other, and they are the same
   * link.
   *
   * Read from source rather than rendered, because the point is that the list
   * carries no labels at all any more: a tile cannot disagree with the sidebar
   * if it has nothing of its own to disagree with.
   */
  it("gives the dashboard's quick actions no labels of their own", () => {
    const src = readSource("src", "app", "(app)", "dashboard", "page.tsx");
    const list = src.slice(src.indexOf("const QUICK_ACTIONS"), src.indexOf("];", src.indexOf("const QUICK_ACTIONS")));
    expect(list, "QUICK_ACTIONS is not where a screen gets named").not.toMatch(/label:/);
    // And the tiles ask the sidebar for the name instead.
    expect(src).toMatch(/screenName\(a\.href\)/);
  });

  it("points every quick action at a screen the sidebar still has", () => {
    /**
     * `/qualification` sat here after that screen was merged into `/bracket`.
     * It rendered for nobody — `navHrefs.has()` filtered it — so nothing was
     * visibly wrong, and a dead row in a list of live ones is exactly what
     * nobody notices until they copy it.
     */
    const src = readSource("src", "app", "(app)", "dashboard", "page.tsx");
    const list = src.slice(src.indexOf("const QUICK_ACTIONS"), src.indexOf("];", src.indexOf("const QUICK_ACTIONS")));
    const hrefs = [...list.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(4);

    const known = new Set(allNavItems().map((i) => i.href));
    expect(hrefs.filter((h) => !known.has(h)), "these are not screens any more").toEqual([]);
  });
});

describe("a match is not offered the apparatus of running a field", () => {
  /**
   * The sidebar has closed these for a match since it learned about
   * `isMatch`: no flights to divide, no tee sheet to draw, nothing to
   * announce, nobody to hire. The setup checklist had never been told, so
   * `/event` went on offering "Flights" and "Access & staff" one card below a
   * sidebar that had shut both — the same doors reopened, on the screen a
   * casual round is most likely to be opened from.
   *
   * Read through the nav's own set rather than a second list, so the two
   * cannot drift.
   */
  const asMatch = (over: Partial<ChecklistState> = {}) =>
    setupChecklist({ ...empty, isMatch: true, ...over }).map((i) => i.href);

  it("drops the field-only steps", () => {
    const hrefs = asMatch();
    expect(hrefs).not.toContain("/grouping");
    expect(hrefs).not.toContain("/access");
  });

  it("keeps the steps a match genuinely has", () => {
    /**
     * The field screen stays: it is where a mistyped name or a wrong handicap
     * gets fixed and there is nowhere else. Rounds stays because changing 18
     * to 9, or gross to net, is exactly the second thought two people have on
     * the first tee.
     */
    const hrefs = asMatch();
    expect(hrefs).toContain("/registration");
    expect(hrefs).toContain("/stages");
  });

  it("leaves a tournament with all of them — the control", () => {
    // Without this the two above pass against a checklist that has dropped
    // those steps for everybody.
    const hrefs = setupChecklist(empty).map((i) => i.href);
    expect(hrefs).toContain("/grouping");
    expect(hrefs).toContain("/access");
  });

  it("agrees with the sidebar about which screens those are", () => {
    /**
     * The point of exporting the set: if somebody decides a match should have
     * a tee sheet after all, they change one line and both readers follow.
     */
    for (const key of TOURNAMENT_ONLY_SCREENS) {
      expect(screenAppliesToMatch(key), key).toBe(false);
      expect(asMatch(), key).not.toContain(`/${key}`);
    }
    expect(screenAppliesToMatch("stages")).toBe(true);
    expect(screenAppliesToMatch("registration")).toBe(true);
  });
});
