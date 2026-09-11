import { describe, it, expect } from "vitest";
import { navForRole, screenName, TOURNAMENT_ONLY_SCREENS } from "../nav";
import { readSource } from "./source";

/**
 * A casual round's console, kept simple.
 *
 * Walked on 2026-09-10: set a quick round up as two people playing on Sunday,
 * pressed "Start the round", and landed in the organizer console with ten
 * links — "Tournament details", "Registration & field", "Rounds & formats",
 * "Messages", "Reports & export" — under headings reading Set up, Manage and
 * Results. A filing cabinet for an event that does not exist, describing a
 * round that is deleted tomorrow.
 *
 * The first attempt at this renamed those screens. That was the wrong fix and
 * was called out as such: renaming leaves a fourball inside a registration
 * desk with approvals and a waitlist, and inside a rounds screen with cut
 * lines and tiebreakers, reading friendlier labels. The two worlds were still
 * mixed.
 *
 * So they are gone, and `CasualRoundPanel` is what a round actually needs —
 * holes, shots, and the handicaps — on its own screen. Removing a door without
 * replacing it is stranding, which is the failure this session spent the day
 * removing elsewhere, so the replacement is asserted here too.
 */
const sidebar = (isMatch: boolean) => navForRole("admin", undefined, { isMatch, isPlayerToo: true });
const keys = (isMatch: boolean) => sidebar(isMatch).flatMap((s) => s.items.map((i) => i.key));
const labels = (isMatch: boolean) => sidebar(isMatch).flatMap((s) => s.items.map((i) => i.label));

describe("what a casual round's sidebar offers", () => {
  it("offers no tournament setup screens at all", () => {
    const ks = keys(true);
    for (const gone of ["event", "registration", "stages", "grouping", "access", "messages"]) {
      expect(ks, gone).not.toContain(gone);
    }
    // And none of the club's, which was already true and must stay true.
    for (const gone of ["organization", "roster", "series", "prizes"]) {
      expect(ks, gone).not.toContain(gone);
    }
  });

  it("keeps the golf, the board and the bet", () => {
    const ks = keys(true);
    for (const kept of ["dashboard", "entry", "leaderboard", "group-games", "me", "rules"]) {
      expect(ks, kept).toContain(kept);
    }
  });

  it("is short enough to read at a glance", () => {
    /**
     * The number IS the feature. Ten links for two people playing each other
     * on a Sunday is what this is fixing, and a cap is the only assertion that
     * notices a screen quietly being added back.
     *
     * Deliberately a ceiling rather than an exact list — a casual round
     * gaining one genuinely useful screen should not be a test failure, and
     * gaining five should.
     */
    expect(keys(true).length).toBeLessThanOrEqual(7);
    // And a tournament keeps its full console, so this is not a cap on
    // everybody.
    expect(keys(false).length).toBeGreaterThan(12);
  });

  it("heads what is left with what is happening, not a lifecycle", () => {
    // "Set up → Manage → Results" describes running a competition, which is a
    // strange thing to show somebody who has just pressed "Start the round".
    const ss = sidebar(true).map((s) => s.label);
    expect(ss).toContain("Playing");
    for (const gone of ["Set up", "Manage", "Results", "Club"]) {
      expect(ss, gone).not.toContain(gone);
    }
  });

  it("leaves a tournament's sidebar exactly as it was", () => {
    // The control, and the one that matters most: a change for ONE shape that
    // leaked would rewrite the console for every club in the product.
    const ls = labels(false);
    for (const kept of ["Registration & field", "Rounds & formats", "Tournament details", "Messages"]) {
      expect(ls, kept).toContain(kept);
    }
    expect(sidebar(false).map((s) => s.label)).toContain("Set up");
  });
});

/**
 * REMOVING A DOOR WITHOUT REPLACING IT IS STRANDING.
 *
 * `roles.test.ts` used to assert `registration` and `stages` PRESENT on a
 * match, on a reason that was right about the need: the field screen is where
 * a wrong handicap gets fixed, and Rounds is where eighteen becomes nine. Both
 * are real things a fourball does. They just do not need a registration desk
 * to do them.
 */
describe("what replaces them", () => {
  const panel = () => readSource("src/components/CasualRoundPanel.tsx");

  it("changes the holes, the shots and the handicaps", () => {
    const src = panel();
    expect(src).toMatch(/setStageHoles\(stageId, n\)/);
    expect(src).toMatch(/setStageScoringBasis\(stageId, "gross"\)/);
    expect(src).toMatch(/setStageScoringBasis\(stageId, "net"\)/);
    expect(src).toMatch(/updateSignup\(p\.id, \{ handicap: n \}\)/);
  });

  it("reuses the tournament's own actions rather than writing a second set", () => {
    // They carry the authorization and the validation. A parallel set written
    // for casual rounds would be a second place for those rules to be wrong —
    // the defect class this codebase keeps paying for. What is separate is the
    // SCREEN, not the engine.
    expect(panel()).toMatch(/from "@\/app\/actions\/tournament"/);
  });

  it("refuses to leave a round with fewer than two players", () => {
    // Two is the smallest round there is; removing the second leaves no round.
    expect(panel()).toMatch(/players\.length > 2/);
  });

  it("shows a plus handicap as a plus, never as a minus", () => {
    // Stored negative. "-2" beside a name is the kind of wrong that looks
    // right and puts the shots in the wrong holes.
    expect(panel()).toMatch(/startsWith\("\+"\)/);
  });

  it("is on the round's own screen, for whoever set it up", () => {
    const dash = readSource("src", "app", "(app)", "dashboard", "page.tsx");
    expect(dash).toMatch(/matchEvent && isStaff && casualStage && \(/);
    expect(dash).toMatch(/<CasualRoundPanel/);
  });

  it("is not on a tournament's dashboard", () => {
    // A club has its own screens for all of this, and two places to set one
    // number is how they come to disagree.
    const dash = readSource("src", "app", "(app)", "dashboard", "page.tsx");
    const at = dash.indexOf("<CasualRoundPanel");
    expect(at).toBeGreaterThan(-1);
    expect(dash.slice(0, at)).toMatch(/matchEvent && isStaff/);
  });
});

/**
 * A screen still has one name.
 *
 * `screenName`'s docstring states the rule: a cross-reference "has to call it
 * what the sidebar calls it, or the reader hunts for a screen that is not in
 * the list". Only one screen is renamed for a casual round now, and the reader
 * takes the shape so the two cannot split.
 */
describe("what a casual round calls the screens it keeps", () => {
  it("calls the export and the overview what they are for a round", () => {
    expect(screenName("/reports", true)).toBe("Export this round");
    expect(screenName("/reports")).toBe("Reports & export");
    // "Dashboard" is a word for a desk, and this screen already titles itself
    // "The match" on a casual round — the sidebar was the half still calling
    // it something else.
    expect(screenName("/dashboard", true)).toBe("This round");
    expect(screenName("/dashboard")).toBe("Dashboard");
  });

  it("renames nothing else", () => {
    // Score entry, the board, the rules and the money mean the same thing to a
    // fourball as to a championship. A map that grew past the two above would
    // be the console quietly becoming two consoles.
    for (const href of ["/entry", "/leaderboard", "/rules", "/group-games", "/me"]) {
      expect(screenName(href, true), href).toBe(screenName(href, false));
    }
  });

  it("is what the dashboard's tiles ask, with the shape passed in", () => {
    const src = readSource("src", "app", "(app)", "dashboard", "page.tsx");
    expect(src).toMatch(/screenName\(a\.href, matchEvent\)/);
  });

  it("keeps one set of screens for both readers", () => {
    // The sidebar and the per-tournament setup checklist ask the same set, so
    // a decision about a casual round is made in one line.
    for (const key of ["event", "registration", "stages", "messages"]) {
      expect(TOURNAMENT_ONLY_SCREENS.has(key), key).toBe(true);
    }
  });
});

/**
 * And the card screen, which is where a casual golfer actually spends the
 * round.
 *
 * Walked on 2026-09-10 after the sidebar was cut: the screen itself still
 * carried "Import scores" — bring in a whole round from a spreadsheet —
 * "Clear scores", whose own tooltip says it removes scores "without touching
 * the draw", and a toggle between entering "Match by match" and across the
 * "Whole field". Two people standing on the same tee have no spreadsheet, no
 * draw and no field.
 */
describe("the card screen on a casual round", () => {
  const entry = () => readSource("src/components/EntryModes.tsx");

  it("offers no spreadsheet import and no bulk clear", () => {
    const src = entry();
    expect(src).toMatch(/isStaff && !casual && \(/);
    expect(src).toMatch(/isStaff && !casual && !clearing && \(/);
  });

  it("does not ask how to type the scores in", () => {
    // `defaultMode` reads the round's own format, so for a casual round the
    // toggle only ever offers the wrong one of the two — under a label
    // describing a field they do not have.
    expect(entry()).toMatch(/\{!casual && \(/);
  });

  it("does not offer a committee step to a round that has no committee", () => {
    /**
     * A CONTRADICTION, not clutter.
     *
     * `createMatch` sets a quick round to player confirmation and says why in
     * its own words: "there is no committee to approve a card that both
     * players just agreed on standing on the 18th green". #281 made the
     * player's own screens say exactly that — a signed card reads "Certified
     * — that's your card", toned done, and `/play` tells them nobody else has
     * to accept it.
     *
     * `RoundApproval` was still telling the same person, one screen away,
     * that "only accepted cards are results". Both were shown to whoever set
     * the round up, because they are staff of their own personal organization
     * and `isStaff` is therefore true for a fourball of two.
     */
    expect(entry()).toMatch(/mode === "stroke" && isStaff && !casual && \(/);
  });

  it("still gives a tournament its committee step", () => {
    // The control, and the more important half: a club medal's cards are not
    // results until somebody accepts them, and that panel is where.
    expect(entry()).toMatch(/<RoundApproval/);
  });

  it("keeps all three for a tournament, which is what they are for", () => {
    // The control. A club typing up Saturday's cards on Monday is exactly who
    // the import exists for.
    const src = entry();
    expect(src).toMatch(/Import scores/);
    expect(src).toMatch(/Clear scores/);
    expect(src).toMatch(/Match by match/);
    expect(src).toMatch(/Whole field/);
  });

  it("heads the screen with the section the sidebar puts it in", () => {
    // "Manage" is the tournament's word and the sidebar's section; on a casual
    // round that section is "Playing", and the kicker follows it.
    expect(entry()).toMatch(/\{casual \? "Playing" : "Manage"\}/);
  });

  it("still calls the screen what the sidebar calls it", () => {
    /**
     * The heading was briefly renamed to "The card" and put back. A screen has
     * one name — `screenName` states the rule — and a heading disagreeing with
     * the sidebar is that rule broken on the page that has it open.
     */
    expect(entry()).toMatch(/<h1[^>]*>Score entry<\/h1>/);
    expect(screenName("/entry", true)).toBe("Score entry");
  });

  it("is told which shape it is by the page, not left to guess", () => {
    const page = readSource("src", "app", "(app)", "entry", "page.tsx");
    // Read ONCE into `casualRound` and passed down. Three things on that page
    // turn on it now — this prop, the venue library's scope, and nothing else
    // should have to ask a second time.
    expect(page).toMatch(/const casualRound = isMatch\(state\.event\.shape\)/);
    expect(page).toMatch(/casual=\{casualRound\}/);
  });

  it("offers the club's courses even though the round is not the club's", () => {
    /**
     * The regression this fixes, and it was one I introduced: once a quick
     * round moved into the person's own organization, the venue picker on this
     * screen asked THAT organization for its courses and got none. A secretary
     * setting up a fourball at their own course could no longer find it.
     *
     * `/match/new` has always read the person's memberships for the same
     * picker, so the two screens now ask one question. A golf course is a
     * physical place, not club apparatus — offering it is a convenience, not
     * the club taking the round over.
     */
    const page = readSource("src", "app", "(app)", "entry", "page.tsx");
    expect(page).toMatch(/casualRound \? await organizationIdsFor\(session\.email\) : state\.event\.organizationId/);
  });
});

/**
 * THE SAME SCOPE MISTAKE, THREE TIMES.
 *
 * Once a quick round stopped belonging to a club, every read scoped to the
 * EVENT's organization started asking a personal organization for a club's
 * data and getting nothing. It was found three times by reading:
 *
 *   - the venue picker on the card screen, which lost the club's courses;
 *   - `createMatch`'s member re-read, which turned every club member into a
 *     guest and cut their handicap loose from the club's own record;
 *   - the course-setup prompt, whose entire job is to offer a course and which
 *     offered an empty library.
 *
 * Three is enough to stop finding them one at a time. This pins the rule at
 * the only screen a casual round can reach that reads a club list at all —
 * `/event` is tournament-only, and the sidebar test above is what keeps it so.
 */
describe("reading a club's lists from a casual round", () => {
  it("scopes every club-course read to the person, not to the round's organization", () => {
    const page = readSource("src", "app", "(app)", "entry", "page.tsx");
    const calls = page.split("clubCourses(").slice(1);
    // Both of them: the setup prompt and the venue picker.
    expect(calls.length).toBe(2);
    for (const [i, call] of calls.entries()) {
      const args = call.slice(0, 160);
      expect(args, `clubCourses call ${i + 1}`).toMatch(
        /casualRound \? await organizationIdsFor\(session\.email\) : state\.event\.organizationId/,
      );
    }
  });

  it("re-reads a claimed member id against the person's clubs", () => {
    // Wider than the round's organization, and still a re-read: an id from a
    // form is never believed. See casual-round-member-link.audit.test.ts.
    const setup = readSource("src/app/actions/match-setup.ts");
    expect(setup).toMatch(/organizationId: \{ in: await organizationIdsFor\(session\.email\) \}/);
    expect(setup).toMatch(/realMembers\.has\(p\.memberId\) \? p\.memberId : null/);
  });

  it("still creates the round in the person's own organization", () => {
    // The line all of this sits on: the club's lists may be READ, and the club
    // gets no ownership of the round.
    const setup = readSource("src/app/actions/match-setup.ts");
    expect(setup).toMatch(/personalOrganizationFor\(session\.email, session\.name\)/);
  });
});
