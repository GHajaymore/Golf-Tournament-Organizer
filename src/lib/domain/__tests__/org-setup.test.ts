import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { orgSetupState, SETUP_HREF, type OrgSetupFacts } from "../org-setup";

/**
 * Every route this app serves, read off the filesystem.
 *
 * Swept rather than listed, for the reason `e2e/layout.spec.ts` gives about
 * layout: a hand-written list covers what its author remembered, and the ones
 * it misses get no assertion at all. Route GROUPS — the `(app)` and `(player)`
 * directories — are organisational and do not appear in the URL, so they are
 * stripped the same way Next strips them.
 */
function appRoutes(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // A route group contributes nothing to the path.
      const segment = /^\(.*\)$/.test(entry.name) ? prefix : `${prefix}/${entry.name}`;
      out.push(...appRoutes(join(dir, entry.name), segment));
    } else if (entry.name === "page.tsx") {
      out.push(prefix || "/");
    }
  }
  return out;
}

const ROUTES = new Set(appRoutes(join(process.cwd(), "src", "app").split("/").join(sep)));

const facts = (over: Partial<OrgSetupFacts> = {}): OrgSetupFacts => ({
  kind: "club",
  named: true,
  hasCourse: true,
  memberCount: 30,
  eventCount: 1,
  moneyAnswered: true,
  ...over,
});

describe("org setup checklist", () => {
  it("asks a club for a course and a roster", () => {
    const keys = orgSetupState(facts()).steps.map((s) => s.key);
    expect(keys).toContain("course");
    expect(keys).toContain("roster");
  });

  it("never asks a personal organizer for a shared roster", () => {
    // A step that cannot apply is worse than one merely undone: it reads as
    // the app having misunderstood what this organizer is.
    const keys = orgSetupState(facts({ kind: "personal" })).steps.map((s) => s.key);
    expect(keys).not.toContain("roster");
    expect(keys).not.toContain("course");
  });

  it("offers a club the money question, already answered", () => {
    // The shop takes the entry fee and the professional pays the winner, so
    // the default is right and nothing is waiting on the organizer. But a
    // club's annual away day IS an outing, and `resolveMoneyMode` lets one
    // tournament differ — a default nobody can see is a restriction, so the
    // row is present and ticked rather than absent.
    const s = orgSetupState(facts({ kind: "club", moneyAnswered: false }));
    expect(s.steps.map((x) => x.key)).toContain("money");
    expect(s.steps.find((x) => x.key === "money")?.done).toBe(true);
    // ...and it must not hold the checklist open forever.
    expect(s.remaining.map((x) => x.key)).not.toContain("money");
  });

  it("says a club's pots are worked out even though its costs are not", () => {
    // The distinction the money-game fix rests on: a pot is a result, not a
    // cash book, and a club runs skins every Saturday.
    const s = orgSetupState(facts({ kind: "club" }));
    expect(s.steps.find((x) => x.key === "money")?.blurb).toMatch(/[Ss]kins/);
  });

  it("leaves the money question genuinely open for a society", () => {
    // Here it IS waiting on somebody: nothing sensible can be defaulted when
    // the whole point is who fronted what.
    const s = orgSetupState(facts({ kind: "community", moneyAnswered: false }));
    expect(s.steps.find((x) => x.key === "money")?.done).toBe(false);
    expect(s.remaining.map((x) => x.key)).toContain("money");
  });

  it("stays ready for a club that has never answered the money question", () => {
    expect(orgSetupState(facts({ kind: "club", moneyAnswered: false })).ready).toBe(true);
  });

  it("points at the first undone step and no further", () => {
    /**
     * `eventCount: 1`, and it used to be 0.
     *
     * With no tournament, every step but the tournament itself is unreachable
     * — `/roster` bounces an eventless session straight back to /choose — so
     * "the first undone step" was answered with a dead link, and this test
     * asserted it. The mechanism it is really about is "first undone, not
     * second", which needs a fixture where the question has a real answer.
     * The no-tournament case has its own block below.
     */
    const s = orgSetupState(facts({ memberCount: 0, eventCount: 1 }));
    expect(s.next?.key).toBe("roster");
    expect(s.ready).toBe(false);
  });

  it("is ready when everything that applies is done", () => {
    const s = orgSetupState(facts());
    expect(s.ready).toBe(true);
    expect(s.next).toBeNull();
  });

  it("is ready for a personal organizer who has only named it and made an event", () => {
    // The steps a personal organizer never had are not 'skipped' — they do
    // not exist, so they cannot hold readiness back.
    const s = orgSetupState(facts({ kind: "personal", hasCourse: false, memberCount: 0 }));
    expect(s.ready).toBe(true);
  });

  it("says what an undone step costs, where it costs anything", () => {
    const s = orgSetupState(facts({ memberCount: 0 }));
    expect(s.next?.consequence).toContain("empty field");
  });

  it("keeps every step reachable regardless of order", () => {
    // The whole point: this is a checklist, not a gate. A tournament created
    // before the roster is loaded is a normal way to work.
    const s = orgSetupState(facts({ memberCount: 0, eventCount: 1 }));
    expect(s.steps.find((x) => x.key === "tournament")?.done).toBe(true);
    expect(s.steps.find((x) => x.key === "roster")?.done).toBe(false);
  });

  it("treats an unknown kind as something rather than crashing", () => {
    expect(() => orgSetupState(facts({ kind: "nonsense" }))).not.toThrow();
    expect(orgSetupState(facts({ kind: null })).steps.length).toBeGreaterThan(0);
  });
});

describe("naming the organization", () => {
  it("asks a club and a society to name it, because everyone sees that name", () => {
    // It lands on every scorecard, the console header and the public board.
    for (const kind of ["club", "community"]) {
      const s = orgSetupState(facts({ kind, named: false }));
      expect(s.steps.find((x) => x.key === "profile")?.done, kind).toBe(false);
    }
  });

  it("does not ask a personal organizer, whose derived name is a real answer", () => {
    // Their organization is their own list of players and nobody else ever
    // sees what it is called, so "named after me" is complete rather than
    // outstanding.
    const s = orgSetupState(facts({ kind: "personal", named: false }));
    expect(s.steps.find((x) => x.key === "profile")?.done).toBe(true);
  });

  it("titles the step in English for every kind", () => {
    // "Name your personal" was what the label produced.
    for (const kind of ["club", "community", "personal"]) {
      const title = orgSetupState(facts({ kind })).steps.find((x) => x.key === "profile")?.title;
      expect(title, kind).toMatch(/^Name your (club|society|outing)$/);
    }
  });
});

describe("the checklist links somewhere that exists", () => {
  /**
   * THE BUG THIS EXISTS FOR. The first version of org-setup.ts invented all
   * five of its paths — `/settings/organization`, `/courses`, `/members`,
   * `/tournaments/new` — and not one of them is a route this app serves. Every
   * row was a dead link. Nothing caught it: the component was never mounted,
   * the render test asserted the same invented string the code used, and a
   * path is not the kind of thing a type can check.
   *
   * So it is checked against the filesystem instead. A step that points
   * nowhere now fails here the moment somebody adds it.
   */
  it("points every step at a route that exists", () => {
    for (const [key, href] of Object.entries(SETUP_HREF)) {
      const path = href.split("?")[0];
      expect(ROUTES.has(path), `${key} -> ${href} (routes: ${[...ROUTES].sort().join(", ")})`).toBe(true);
    }
  });

  it("found the routes at all, so an empty sweep cannot pass it vacuously", () => {
    // A sweep that silently returns nothing would make the test above pass for
    // every href in the world.
    expect(ROUTES.size).toBeGreaterThan(10);
    expect(ROUTES.has("/choose")).toBe(true);
  });

  it("gives every step in the state a href from the table", () => {
    // Belt and braces: the steps must not go around SETUP_HREF with a literal.
    const known = new Set(Object.values(SETUP_HREF));
    for (const kind of ["club", "community", "personal"]) {
      for (const step of orgSetupState(facts({ kind })).steps) {
        expect(known.has(step.href), `${kind}/${step.key} -> ${step.href}`).toBe(true);
      }
    }
  });
});

/**
 * THREE OF THE FOUR FIRST-RUN ROWS WERE LINKS THAT BOUNCED.
 *
 * The docstring at the top of `org-setup.ts` has said the whole of this since
 * the file was written: "/organization and /roster are inside the (app) shell,
 * which requireEventSession gates on an ACTIVE EVENT … until that changes, the
 * only step a brand-new organization can actually do is create its first
 * tournament, and the checklist must not pretend otherwise."
 *
 * It pretended. Walked on 2026-09-10: signed up as a society, pressed the
 * first row — "Name your society", carrying the Next chip — and arrived back
 * on /choose with no explanation, under a sentence promising that "nothing
 * here is locked". Same for "Add your members" and "Decide how money works".
 *
 * A rule stated in a comment and checked by nothing is the exact failure this
 * codebase keeps unwinding, so it is checked here twice: that the checklist
 * marks those steps, and that the marking is TRUE of the routes rather than a
 * guess that could rot the day a screen stops needing an event.
 */
describe("a brand-new organization with no tournament", () => {
  const fresh = (over: Partial<OrgSetupFacts> = {}) =>
    orgSetupState(facts({ eventCount: 0, named: false, memberCount: 0, moneyAnswered: false, ...over }));

  it("marks every step that lives inside a tournament, and no longer the club's own", () => {
    /**
     * THE CLUB IS SET UP ONCE; THE TOURNAMENTS ARE MANY.
     *
     * This used to assert that every step but `/choose` was blocked, because
     * every club screen reached its organization through whichever tournament
     * was open. That made the one-time decisions — the club's name, its
     * colours, its handicap policy, how its money works — unreachable until a
     * tournament existed to stand inside, which is the second thing done
     * first.
     *
     * `/organization` answers from `primaryOrganizationFor` now, and `/roster`
     * from `requireOrgScreen`, so every club step is reachable on day one.
     *
     * THE MEMBER LIST WAS THE LAST ONE, and freeing it is what made the club
     * steps a real prerequisite rather than a wish: a gate demanding members
     * before the first tournament, while the members screen demanded a
     * tournament, is a deadlock dressed as a checklist. What it shows without
     * one is the roster and nothing else — the field count, the entry filter
     * and "add these to the tournament" are simply absent.
     *
     * `/event` is still blocked and always will be: it IS a tournament's own
     * screen. The pair of tests below hold both halves of that claim to the
     * routes rather than to this list.
     */
    const eventless = ["/choose", "/organization", "/roster"];
    for (const step of fresh().steps) {
      const free = eventless.some((h) => step.href.startsWith(h));
      expect(!!step.blocked, `${step.key} -> ${step.href}`).toBe(!free);
    }
  });

  it("leaves the one step that can actually be done alone", () => {
    const tournament = fresh().steps.find((s) => s.key === "tournament");
    expect(tournament?.blocked).toBe("");
  });

  it("points Next at naming the club, which is now the first thing that works", () => {
    /**
     * It pointed at "Create your first tournament", because that was the only
     * reachable step — "Name your society" bounced. Naming the club is the
     * first thing a secretary actually does, and now that it works it is where
     * the chip belongs.
     *
     * Still the same rule underneath: Next is the first REACHABLE unfinished
     * step. What changed is which steps are reachable.
     */
    const s = fresh();
    expect(s.next?.key).toBe("profile");
    expect(s.next?.blocked).toBe("");
  });

  it("says why, rather than just going quiet", () => {
    // The course step points at `/event`, which IS a tournament's own screen,
    // so it is blocked — and still has to say so rather than going grey.
    const course = fresh({ kind: "club" }).steps.find((s) => s.key === "course");
    expect(course?.blocked).toMatch(/tournament/i);
  });

  it("blocks nothing at all once one tournament exists", () => {
    // The control. Without it every assertion above is satisfied by a
    // checklist that blocks everything for ever.
    for (const step of orgSetupState(facts({ eventCount: 1 })).steps) {
      expect(step.blocked, step.key).toBe("");
    }
    expect(orgSetupState(facts({ eventCount: 1, named: false })).next?.key).toBe("profile");
  });

  it("marks the same steps for every kind of organization", () => {
    // A society, a club and a one-off outing get different STEPS, and which of
    // them need a tournament does not depend on what the outfit is.
    const eventless = ["/choose", "/organization", "/roster"];
    for (const kind of ["club", "community", "personal"]) {
      for (const step of fresh({ kind }).steps) {
        const free = eventless.some((h) => step.href.startsWith(h));
        expect(!!step.blocked, `${kind}/${step.key}`).toBe(!free);
      }
    }
  });
});

/**
 * And the marking has to be TRUE, not merely consistent.
 *
 * The assertions above would all pass against a checklist that blocked the
 * right rows for the wrong reason — and would go on passing on the day
 * somebody makes `/roster` reachable without an event, quietly telling
 * organizers a screen is shut when it is open. So this reads the routes.
 */
describe("what the checklist claims about a screen matches the screen", () => {
  const pageSource = (href: string) => {
    const route = href.split(/[?#]/)[0];
    // The route groups are stripped from the URL, so the file could be under
    // either shell. Both are tried rather than one assumed.
    for (const group of ["(app)", "(player)", ""]) {
      const path = join(process.cwd(), "src", "app", group, route.slice(1), "page.tsx");
      try {
        return readFileSync(path, "utf8");
      } catch {
        /* next candidate */
      }
    }
    throw new Error(`no page file for ${href}`);
  };

  it("every step it blocks really does need an event", () => {
    for (const step of orgSetupState(facts({ eventCount: 0 })).steps) {
      if (!step.blocked) continue;
      const src = pageSource(step.href);
      // `requireScreen` and `requireState` both go through
      // `requireEventSession`, which is the redirect that does this.
      expect(src, `${step.href} is blocked but does not require an event`).toMatch(
        /require(Screen|EventSession|State)\(/,
      );
    }
  });

  it("the step it does NOT block really is reachable without one", () => {
    const tournament = orgSetupState(facts({ eventCount: 0 })).steps.find(
      (s) => s.key === "tournament",
    )!;
    const src = pageSource(tournament.href);
    // /choose is where an eventless session is SENT, so it cannot itself
    // demand one. This is the assertion that fails if the picker is ever put
    // inside the event shell.
    expect(src).not.toMatch(/require(Screen|EventSession|State)\(/);
  });
});

/**
 * And it calls the tenant what the tenant is called.
 *
 * This file already records the same slip once — "Name your personal", from
 * using the label where the noun belongs — and the blocked note repeated it
 * the day it was written: "your club's own screens live inside one", shown to
 * a society. Read off the screen during the walk that found the dead links.
 */
describe("the blocked note speaks each organization's own language", () => {
  it("says society to a society and club to a club", () => {
    /**
     * READ OFF `blockedByClubSetup` RATHER THAN `blocked`, because there is
     * usually no blocked step left to read. Only `/event` still needs a
     * tournament, and only a club has a course step pointing at it — so a
     * society's checklist now has no blocked row at all, and the old version
     * of this test crashed on a non-null assertion rather than failing.
     *
     * The prose that varies by outfit is the setup gate, which every kind
     * with required steps gets, so that is what has to speak the language.
     */
    const noteFor = (kind: string) =>
      orgSetupState(facts({ kind, eventCount: 0, named: false, memberCount: 0 })).blockedByClubSetup;
    expect(noteFor("community")).toContain("society");
    expect(noteFor("community")).not.toContain("club");
    expect(noteFor("club")).toContain("club");
  });

  it("says nothing at all to somebody running a one-off outing with friends", () => {
    /**
     * THE STANDALONE ESCAPE, and it is derived rather than written as a
     * `kind === "personal"` special case anywhere. A personal organizer has no
     * shared roster, so no members step exists for them; their name step is
     * already done because nobody else ever sees the organization's name; and
     * the money step is not a prerequisite. Nothing required is outstanding,
     * so nothing is asked.
     *
     * `moneyAnswered: false` IS THE POINT, and leaving it out made this test
     * decoration. The base fixture answers the money question, so without this
     * line the assertion passed against a build where money WAS a prerequisite
     * — proven by mutation on 2026-09-11, which stayed green. A personal
     * organizer has `ledger: true`, so their money step is the one thing that
     * would still be outstanding, and it is the only route by which this
     * escape can break.
     */
    const s = orgSetupState(
      facts({ kind: "personal", eventCount: 0, named: false, memberCount: 0, moneyAnswered: false }),
    );
    expect(s.steps.some((x) => x.key === "money" && !x.done), "the money step is genuinely undone").toBe(true);
    expect(s.blockedByClubSetup).toBe("");
    expect(s.outstanding).toEqual([]);
  });

  it("names the steps it is waiting for, rather than saying 'finish setup'", () => {
    // Three club answers could be outstanding at once. "Complete your setup
    // first" over three of them leaves somebody hunting for which.
    const s = orgSetupState(facts({ kind: "community", eventCount: 0, named: false, memberCount: 0 }));
    expect(s.blockedByClubSetup).toContain("name your society");
    expect(s.blockedByClubSetup).toContain("add your members");
    expect(s.outstanding.map((x) => x.key)).toEqual(["profile", "roster"]);
  });

  it("never waits on a convenience", () => {
    /**
     * The course card and the money question are both real steps and neither
     * is a prerequisite: a tournament carries its own pars and stroke index,
     * and `resolveMoneyMode` is event → club → kind, so a tournament answers
     * the money question for itself. Gating on either is how a gate stops
     * being believed.
     */
    const s = orgSetupState(
      facts({ kind: "club", eventCount: 0, named: true, memberCount: 3, hasCourse: false, moneyAnswered: false }),
    );
    expect(s.steps.some((x) => x.key === "course" && !x.done), "the course step is genuinely undone").toBe(true);
    expect(s.blockedByClubSetup).toBe("");
  });

  it("stops asking for ever once one tournament exists", () => {
    /**
     * THE ASSERTION THAT KEEPS THIS SAFE FOR EVERY EXISTING CUSTOMER. One
     * tournament proves the club is a going concern, and a gate that stopped
     * one mid-season to collect a field it had skipped would be the app
     * interrupting real golf to tidy its own records.
     */
    const s = orgSetupState(facts({ kind: "community", eventCount: 1, named: false, memberCount: 0 }));
    expect(s.blockedByClubSetup).toBe("");
    expect(s.outstanding).toEqual([]);
    // And the steps themselves are still honestly reported as undone.
    expect(s.remaining.map((x) => x.key)).toContain("profile");
  });

  it("never says the raw kind, whatever kind it is handed", () => {
    // The failure mode is a value falling through into prose. "community" and
    // "personal" are storage words, and neither is a thing anybody calls their
    // golf society.
    for (const kind of ["club", "community", "personal", "", null, "nonsense"]) {
      const blocked = orgSetupState(facts({ kind, eventCount: 0 })).steps.filter((s) => s.blocked);
      for (const step of blocked) {
        expect(step.blocked, `${kind}/${step.key}`).not.toMatch(/community|personal|nonsense/);
      }
    }
  });
});
