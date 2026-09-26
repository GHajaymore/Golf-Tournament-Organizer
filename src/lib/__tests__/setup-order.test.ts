import { describe, it, expect } from "vitest";
import { SETUP_ORDER, bySetupOrder, setupScreens } from "@/lib/domain/setup-flow";
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
  it("runs details, what is played, who plays it, the draw, then the money", () => {
    /**
     * The product decision, pinned. `setup-flow.ts` explains it: deciding the
     * field before deciding whether it is a medal or a knockout is the way
     * round that "had somebody adding players before discovering the format
     * was not the one they wanted".
     */
    //
    // "/teams" since 2026-09-26: the sides, after the field they are made from
    // and before the flights a newcomer mistakes for them. It is a step only in
    // a tournament with a round played in sides — see `teams` on SetupFacts —
    // and is listed here so that, when present, every reader places it alike.
    expect(SETUP_ORDER).toEqual(["/event", "/stages", "/registration", "/teams", "/grouping", "/prizes"]);
  });

  it("orders the dashboard checklist by it", () => {
    /**
     * Two of the five rows are opt-in — the caller passes the flow's own
     * answer or nothing at all — so a caller that passes neither gets
     * SETUP_ORDER with those two absent, which is a SUBSET of the sequence and
     * not a different one. Asserted that way rather than by naming the two, so
     * a third opt-in row added later does not silently pass.
     */
    const hrefs = setupChecklist(empty)
      .map((i) => i.href)
      .filter((h) => SETUP_ORDER.includes(h));
    expect(hrefs).toEqual(SETUP_ORDER.filter((h) => hrefs.includes(h)));
    expect(hrefs.length, "the checklist has lost its guided steps").toBeGreaterThan(2);
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

  it("reads the order off SETUP_ORDER rather than restating it", () => {
    /**
     * The card is prose in JSX rather than a list this can import, so it is
     * read as source — and read through `readSource`, because the comment
     * ABOVE it now names the order too and would otherwise satisfy the
     * assertion on its own. See source-guard.test.ts.
     *
     * Asserted as relative position rather than exact strings: the wording of
     * a step is allowed to change, the sequence is not.
     */
    /**
     * READ AS HREFS NOW, not as prose.
     *
     * The card was a flat `<ol>` of hand-written step names, and this test had
     * to match those strings — which is why it carried "Rounds &amp; formats"
     * with its entity escape. `TournamentJourney` names every screen through
     * `screenName`, so the card can no longer call a screen something the
     * sidebar does not, and the thing left to pin here is the SEQUENCE.
     */
    const src = readSource("src", "components", "TournamentJourney.tsx");
    const at = (s: string) => src.indexOf(s);

    /**
     * IT NO LONGER HAS AN ORDER OF ITS OWN TO CHECK.
     *
     * The setup phase was a hand-written four-element array and this test
     * pinned its sequence in source. That is a second copy of SETUP_ORDER
     * however carefully it is asserted — and it proved it: adding the money
     * step to the guide left this card describing four steps under a count
     * reading "0 of 5".
     *
     * So what is pinned now is that the card SPREADS the order rather than
     * listing it. A card with nothing of its own cannot disagree, which is the
     * same shape as the dashboard's quick actions below.
     */
    // Through `setupScreens` since 2026-09-26 — SETUP_ORDER filtered to the
    // steps THIS tournament has, so the conditional Teams step shows only on a
    // team event. Still no list of its own: the guarantee is unchanged.
    expect(src).toContain("screens: setupScreens(setup?.hrefs)");
    expect(src).toContain('import { setupScreens } from "@/lib/domain/setup-flow"');
    // And no href of its own in that phase — a literal is how the second copy
    // came back last time.
    const setupPhase = src.slice(src.indexOf('key: "setup"'), src.indexOf('key: "launch"'));
    expect(setupPhase, "the setup phase named a screen itself").not.toMatch(/"\/[a-z]/);
    // And setup still finishes before the tournament is handed to the field.
    expect(at("setupScreens(setup"), "the setup phase is gone").toBeGreaterThan(-1);
    expect(at("setupScreens(setup")).toBeLessThan(at('title: "Launch"'));
    // Which in turn comes before playing it and before settling up.
    expect(at('title: "Launch"')).toBeLessThan(at('title: "Play"'));
    expect(at('title: "Play"')).toBeLessThan(at('title: "Finish"'));
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
    setupChecklist({
      ...empty,
      flow: [{ href: "/event", done, missing: "It still needs a name." }],
    });

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
    const hrefs = setupChecklist({
      ...empty,
      flow: [
        { href: "/event", done: false, missing: "It still needs a name." },
        // The conditional step too, so the WHOLE order is exercised — the
        // sides land between the field and the flights, not at the end.
        { href: "/teams", done: false, missing: "No sides yet." },
        { href: "/prizes", done: false, missing: "Nobody has said how money works here." },
      ],
    })
      .map((i) => i.href)
      .filter((h) => SETUP_ORDER.includes(h));
    expect(hrefs).toEqual([...SETUP_ORDER]);
  });
});

describe("the sides step, which only a team event has", () => {
  it("is in the dashboard checklist only when the flow has it", () => {
    expect(setupChecklist(empty).some((i) => i.href === "/teams")).toBe(false);
    const withTeams = setupChecklist({ ...empty, flow: [{ href: "/teams", done: false, missing: "No sides yet." }] });
    const row = withTeams.find((i) => i.href === "/teams");
    expect(row?.detail).toBe("No sides yet.");
    expect(row?.done).toBe(false);
  });

  it("is on the journey card only when the flow has it", () => {
    expect(setupScreens()).not.toContain("/teams");
    expect(setupScreens(["/event", "/stages", "/registration", "/grouping", "/prizes"])).not.toContain("/teams");
    expect(setupScreens(["/event", "/stages", "/registration", "/teams", "/grouping", "/prizes"])).toEqual([
      ...SETUP_ORDER,
    ]);
    // The always-present steps are never dropped — the control.
    expect(setupScreens()).toEqual(SETUP_ORDER.filter((h) => h !== "/teams"));
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
    /**
     * And the tiles ask the sidebar for the name instead.
     *
     * `screenName(a.href` rather than the whole call: it takes a second
     * argument now, because a casual round calls three of these screens
     * something else — "Who's playing" for Registration & field — and the tile
     * has to agree with the sidebar or it recreates the very split this test
     * exists to stop, one shape further along.
     *
     * What is being asserted is unchanged and is the whole point: the tile has
     * nothing of its own to disagree WITH. Where the name comes from is
     * `screenName`; the shape flag only chooses which of its two names.
     */
    expect(src).toMatch(/screenName\(a\.href[,)]/);
    // Never a literal beside it — that is what "no labels of their own" means.
    const tile = src.slice(src.indexOf("screenName(a.href"));
    expect(tile.slice(0, 60)).not.toMatch(/"[A-Z]/);
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

  it("drops the tournament's setup screens too, now a round has its own", () => {
    /**
     * These two USED TO BE ASSERTED PRESENT, on a reason that was right about
     * the need and wrong about the door: "the field screen stays because it is
     * where a mistyped name or a wrong handicap gets fixed, and there is
     * nowhere else; Rounds stays because changing 18 to 9 is exactly the
     * second thought two people have on the first tee."
     *
     * There is somewhere else now. `CasualRoundPanel` puts holes, shots and
     * the handicaps on the round's own screen, so a fourball is no longer
     * walked through a registration desk — approvals, a waitlist, a capacity —
     * or a rounds screen with cut lines and tiebreakers, to change one number.
     */
    const hrefs = asMatch();
    expect(hrefs).not.toContain("/registration");
    expect(hrefs).not.toContain("/stages");
    expect(hrefs).not.toContain("/event");
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
    /**
     * And something a match DOES still have, so the sweep above cannot pass
     * against a set that has grown to cover every screen in the app.
     *
     * This was `stages` and `registration`, which have since moved into the
     * set — the round's own panel replaced them. `entry` is the card and
     * `group-games` the money, and neither will ever leave a casual round:
     * one is the golf and the other is the bet.
     */
    expect(screenAppliesToMatch("entry")).toBe(true);
    expect(screenAppliesToMatch("group-games")).toBe(true);
  });
});

/**
 * AND THE GUIDE'S FIRST STEP LANDS ON THE FIELDS IT ASKED FOR.
 *
 * `/event` WAS two screens in one and said so: "Manage your tournaments, or
 * configure the one you're running." The manager half — every tournament you
 * have, a form to create another, and a link to set up a casual round — sat
 * directly under the heading, and the half the screen is NAMED after sat below
 * all three.
 *
 * Who that catches is the point. The rail's first step points here and
 * describes it as "Say where it is played, or what day". Walked on 2026-09-11
 * with a tournament created a minute earlier: a table of tournaments, then
 * "Create a new tournament", then "Just playing a round?", and the dates and
 * venue fields fourth. An organizer following the guide to fill in a date is
 * met with a form for making another tournament — which is not merely
 * confusing, it is one click from a duplicate.
 *
 * THAT WAS FIXED BY ORDERING, AND IS NOW FIXED BY ADDRESS. The manager moved
 * to `/tournaments`, so the defect is not merely pushed below the fold — it is
 * not on this screen at all, and no future edit to the ordering can bring it
 * back. So this block asserts ABSENCE here plus PRESENCE there, which is both
 * a stronger statement than the old position rule and the safer direction: an
 * absence assertion cannot be satisfied by a comment mentioning the thing.
 *
 * The presence half is not decoration. "The manager is not on /event" is
 * equally true of having deleted it, and deleting the only way to switch
 * tournament is a considerably worse bug than the one being fixed.
 */
describe("what the first setup step puts in front of you", () => {
  const page = () => readSource("src", "app", "(app)", "event", "page.tsx");
  const list = () => readSource("src", "app", "(app)", "tournaments", "page.tsx");

  it("puts nothing about OTHER tournaments on the screen for configuring one", () => {
    const src = page();
    expect(src, "the tournament manager is back on /event").not.toContain("<EventSwitcher");
    /**
     * And not by some other route either. `accessibleEvents` is what lists the
     * tournaments a person can reach; a screen about ONE tournament has no
     * business asking for the set, and this is the query that would come back
     * first if somebody rebuilt the manager here by hand.
     */
    expect(src, "/event is asking for the list of tournaments again").not.toContain("accessibleEvents");
  });

  it("puts the tournament's own fields first on it", () => {
    /**
     * What the rail's first step promised all along. With the manager gone
     * there is nothing between the heading and the fields — but "nothing above
     * it" has to be asserted against something, so it is asserted against the
     * two sections that follow: the course library and the scoring settings,
     * neither of which is what the step asked for.
     */
    const src = page();
    const setupForm = src.indexOf("<EventSetupClient");
    const courses = src.indexOf("<CourseLibrary");
    const scoring = src.indexOf("<PlaySettings");
    expect(setupForm, "<EventSetupClient not found").toBeGreaterThan(-1);
    expect(courses, "<CourseLibrary not found").toBeGreaterThan(-1);
    expect(scoring, "<PlaySettings not found").toBeGreaterThan(-1);
    expect(setupForm).toBeLessThan(courses);
    expect(courses).toBeLessThan(scoring);
  });

  it("moved the manager rather than deleting it", () => {
    /**
     * The control on the absence above. Switching tournament is an ordinary
     * thing to want and `EventContextBar` links to it from every authenticated
     * screen, so "not on /event" is only the right answer while it is
     * somewhere — and `/tournaments` is where the sidebar's Club group already
     * said club-level acts go.
     */
    const src = list();
    expect(src, "nothing renders the tournament manager any more").toContain("<EventSwitcher");
    expect(src, "the list is not scoped to what this person can reach").toContain("accessibleEvents");
  });

  it("uses the same predicate the checklist already uses, not a new one", () => {
    /**
     * `railSpeaks` is the existing answer to "is the ordered guide talking".
     * A second predicate meaning almost the same thing is how the three
     * disagreeing setup orders at the top of this file happened.
     *
     * Three uses once, now one: two of them gated the switcher's position and
     * went with it to `/tournaments`, which does not have a rail. The
     * remaining one is the checklist gate, which is the rule's original
     * reader — "the ordered guide and the flat status board are never both
     * talking".
     */
    const src = page();
    expect(src).toMatch(/import \{ railSpeaks \} from "@\/lib\/domain\/setup-flow"/);
    expect(src.split("railSpeaks(flow)").length - 1).toBe(1);
  });
});
