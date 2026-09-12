import { describe, it, expect } from "vitest";
import { navForRole } from "../nav";
import { SETUP_HREF } from "../domain/org-setup";

/**
 * THE SIDEBAR OF A CLUB THAT HAS NOT CREATED A TOURNAMENT YET.
 *
 * A club is set up once and its tournaments are many, so a secretary spends
 * real time in the app before the first one exists — naming the outfit,
 * loading the roster, deciding how money works. Every OTHER console screen
 * resolves its data from the selected event and `requireEventSession` sends it
 * back to `/choose` without one.
 *
 * So the sidebar in that state offered six live links that all bounced —
 * Dashboard, Live leaderboard, Rules reference, Score entry, Messages, Group
 * games — read off the rendered page on 2026-09-11. That is the same fault the
 * org setup rail was fixed for, and worse here: a sidebar is on every screen
 * and is the thing somebody navigates by.
 *
 * The fix closed the list, which immediately created the opposite fault — a
 * cul-de-sac with no link out at all. Both halves are asserted below, because
 * either one alone is a regression dressed as a fix.
 */

const eventless = () =>
  navForRole("player", undefined, { orgAdminWithoutEvent: true, orgKind: "community" });
const withEvent = () => navForRole("admin", undefined, { orgKind: "community" });

const keysOf = (sections: ReturnType<typeof navForRole>) =>
  sections.flatMap((s) => s.items.map((i) => i.key));

describe("with no tournament open", () => {
  it("offers the club's own screens", () => {
    /**
     * BOTH of them. `/roster` was excluded when this rule was written, on the
     * true-at-the-time grounds that it read the active event for "who is
     * already in this field" — and that exclusion is what made the members
     * step of club setup unreachable, which in turn is why the first-tournament
     * gate could not ask for members. It answers from `requireOrgScreen` now.
     */
    expect(keysOf(eventless())).toContain("organization");
    expect(keysOf(eventless())).toContain("roster");
  });

  it("offers nothing else from the console, because nothing else works", () => {
    /**
     * ASSERTED AS AN ABSENCE over the WHOLE list rather than against a list of
     * six names, so a screen added to `NAV` later cannot quietly appear here.
     * The six that were actually observed bouncing are named in the message so
     * that whoever reads a failure knows what this is about.
     */
    const extra = keysOf(eventless()).filter(
      (k) => !["organization", "roster", "choose"].includes(k),
    );
    expect(
      extra,
      "every console screen but the club's own bounces to /choose without a tournament — " +
        "dashboard, leaderboard, rules, entry, messages and group-games all did",
    ).toEqual([]);
  });

  it("still offers a way out, which closing the list took away", () => {
    /**
     * THE SECOND FAULT, caused by the fix for the first and caught by reading
     * the sidebar again. A society secretary on Members had no link anywhere
     * else at all — worse than the dead links it replaced, because a dead link
     * at least tells you the app has more in it.
     *
     * `/choose` is the only possible answer: the one screen that works with no
     * tournament selected, where the create form lives, and where an eventless
     * session is sent from everywhere else. Pinned to `SETUP_HREF.tournament`
     * so the sidebar and the setup checklist cannot come to point at different
     * doors to the same thing.
     */
    const hrefs = eventless().flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).toContain(SETUP_HREF.tournament);
  });

  it("never leaves the sidebar empty", () => {
    // The failure mode of a closed list is nothing at all, which renders as a
    // shell with no navigation and reads as a broken page.
    expect(eventless().length).toBeGreaterThan(0);
    expect(keysOf(eventless()).length).toBeGreaterThan(1);
  });
});

describe("with a tournament open", () => {
  it("changes nothing", () => {
    /**
     * THE CONTROL, and the assertion that matters most: this rule must be
     * invisible to every organizer who has a tournament, which is all of them
     * after the first day. Without it the tests above are satisfied by a nav
     * that shows two entries to everybody for ever.
     */
    const keys = keysOf(withEvent());
    expect(keys.length).toBeGreaterThan(6);
    expect(keys).toContain("dashboard");
    expect(keys).toContain("leaderboard");
    // And the eventless-only way out does NOT appear — the shell's own
    // switcher does that job once there is something to switch between.
    expect(keys).not.toContain("choose");
  });
});
