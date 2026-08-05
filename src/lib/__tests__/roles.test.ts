import { describe, it, expect } from "vitest";
import { ROLES, SCREEN_ACCESS, canAccessScreen, landingScreenFor, type Role } from "../roles";
import { NAV, navForRole } from "../nav";

const ALL_NAV_KEYS = NAV.flatMap((s) => s.items.map((i) => i.key));

describe("screen access map", () => {
  it("covers every screen in the sidebar", () => {
    const missing = ALL_NAV_KEYS.filter((k) => !(k in SCREEN_ACCESS));
    expect(missing, `nav screens with no access rule: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no access rules for screens that don't exist in the sidebar", () => {
    const orphans = Object.keys(SCREEN_ACCESS).filter((k) => !ALL_NAV_KEYS.includes(k));
    expect(orphans, `access rules with no matching screen: ${orphans.join(", ")}`).toEqual([]);
  });

  it("denies unknown screen keys by default", () => {
    for (const role of ROLES) {
      expect(canAccessScreen(role, "definitely-not-a-screen")).toBe(false);
    }
  });
});

describe("role boundaries", () => {
  it("keeps players out of setup, staff and results screens", () => {
    const forbidden = [
      "event",
      "access",
      "registration",
      "stages",
      "grouping",
      "foursomes",
      "scorecard",
      "qualification",
      "announcements",
      "prizes",
      "reports",
    ];
    for (const key of forbidden) {
      expect(canAccessScreen("player", key), `player must not reach ${key}`).toBe(false);
    }
  });

  it("gives players exactly their own screens", () => {
    const allowed = ALL_NAV_KEYS.filter((k) => canAccessScreen("player", k));
    expect(allowed.sort()).toEqual(["bracket", "dashboard", "entry", "leaderboard"].sort());
  });

  it("keeps assistants out of admin-only screens but in operational ones", () => {
    expect(canAccessScreen("assistant", "event")).toBe(false);
    expect(canAccessScreen("assistant", "access")).toBe(false);
    expect(canAccessScreen("assistant", "registration")).toBe(true);
    expect(canAccessScreen("assistant", "entry")).toBe(true);
  });

  it("gives admins every screen", () => {
    for (const key of ALL_NAV_KEYS) {
      expect(canAccessScreen("admin", key), `admin should reach ${key}`).toBe(true);
    }
  });
});

describe("sidebar matches the guards", () => {
  it("shows a role exactly the screens it is allowed to open", () => {
    for (const role of ROLES) {
      const shown = navForRole(role).flatMap((s) => s.items.map((i) => i.key));
      const allowed = ALL_NAV_KEYS.filter((k) => canAccessScreen(role, k));
      expect(shown.sort(), `sidebar/guard mismatch for ${role}`).toEqual(allowed.sort());
    }
  });

  it("never shows an empty section", () => {
    for (const role of ROLES) {
      for (const section of navForRole(role)) {
        expect(section.items.length, `empty section "${section.label}" for ${role}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("landing screens", () => {
  it("sends every role somewhere that role can actually open", () => {
    for (const role of ROLES) {
      const landing = landingScreenFor(role);
      const key = landing.replace(/^\//, "");
      expect(canAccessScreen(role as Role, key), `${role} lands on ${landing} but cannot open it`).toBe(true);
    }
  });
});
