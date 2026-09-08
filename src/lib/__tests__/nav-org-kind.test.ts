import { describe, it, expect } from "vitest";
import { navForRole } from "../nav";
import { orgProfile, ORG_KINDS } from "../domain/org-profile";

/**
 * The sidebar calls the organization what it actually is.
 *
 * "Club settings" was hard-coded in `NAV`, under a section headed "Club", for
 * every organizer — including the solo one whose own settings page, correctly,
 * described them as "Personal · a single organizer".
 *
 * Guarded HERE rather than only in `org-profile.test.ts`, and that distinction
 * is the whole reason this file exists: the profile test asserts the LABELS,
 * and passed just as happily while the sidebar ignored them. Reverting the nav
 * to the hard-coded "Club" left every profile assertion green. A rule and the
 * reader of that rule need separate tests, which is this codebase's
 * most-repeated lesson.
 */

/** The section that holds the settings screen, whatever it is called now. */
const orgSection = (kind?: string) =>
  navForRole("admin", undefined, kind ? { orgKind: kind as never } : {}).find((s) =>
    s.items.some((i) => i.key === "organization"),
  );

describe("the sidebar follows the kind of organization", () => {
  it("names the section and the settings entry for each kind", () => {
    for (const kind of ORG_KINDS) {
      const profile = orgProfile(kind);
      const section = orgSection(kind);
      expect(section, kind).toBeDefined();
      expect(section!.label, kind).toBe(profile.groupLabel);
      expect(
        section!.items.find((i) => i.key === "organization")!.label,
        kind,
      ).toBe(profile.settingsLabel);
    }
  });

  it("says nothing about a club to an outfit that is not one", () => {
    for (const kind of ORG_KINDS.filter((k) => k !== "club")) {
      const section = orgSection(kind);
      expect(section!.label, kind).not.toMatch(/club/i);
      for (const item of section!.items) expect(item.label, `${kind}/${item.key}`).not.toMatch(/club/i);
    }
  });

  it("still says Club to a club — the control", () => {
    /**
     * Without this, both cases above pass against a sidebar that has had the
     * word removed for everybody, which would be a different bug wearing the
     * same green.
     */
    const section = orgSection("club");
    expect(section!.label).toBe("Club");
    expect(section!.items.find((i) => i.key === "organization")!.label).toBe("Club settings");
  });

  it("falls back to the club wording when no kind is given", () => {
    // Every caller passed nothing before this option existed, and a club is
    // the commonest case — so an omitted kind must not blank the sidebar or
    // invent a third wording.
    const section = orgSection(undefined);
    expect(section!.label).toBe("Club");
    expect(section!.items.find((i) => i.key === "organization")!.label).toBe("Club settings");
  });

  it("changes nothing else in the sidebar", () => {
    /**
     * The kind describes who is RUNNING the tournament, not what the
     * tournament is, so no other screen may appear, vanish or be renamed
     * because of it. Compared whole rather than by spot-check: a relabelling
     * that reached across sections would be invisible to a narrower test.
     */
    const strip = (kind?: string) =>
      navForRole("admin", undefined, kind ? { orgKind: kind as never } : {})
        .filter((s) => !s.items.some((i) => i.key === "organization"))
        .map((s) => `${s.label}:${s.items.map((i) => i.key).join(",")}`);

    for (const kind of ORG_KINDS) {
      expect(strip(kind), kind).toEqual(strip(undefined));
    }
  });
});
