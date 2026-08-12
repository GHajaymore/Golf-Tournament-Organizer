import { describe, it, expect } from "vitest";
import { ROLES, SCREEN_ACCESS, canAccessScreen, landingScreenFor, type Role } from "../roles";
import { NAV, navForRole } from "../nav";
import { DEFAULT_SETTINGS, type TournamentSettings } from "../tournament-settings";

const ALL_NAV_KEYS = NAV.flatMap((s) => s.items.map((i) => i.key));

describe("screen access map", () => {
  it("covers every screen in the sidebar", () => {
    const missing = ALL_NAV_KEYS.filter((k) => !(k in SCREEN_ACCESS));
    expect(missing, `nav screens with no access rule: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no access rules for screens that don't exist in the sidebar", () => {
    // Screens that are real and guarded but deliberately absent from the
    // console's sidebar. Listed rather than exempted by pattern, so adding one
    // stays a decision: an access rule with nothing behind it is dead, and a
    // dead rule is how a screen ends up reachable by the wrong role.
    //
    // "me" is the player shell's root. It has its own four-tab navigation and
    // must never appear in the organizer's sidebar — an organizer reaching it
    // does so to play, not to administer.
    const OFF_SIDEBAR = ["me"];
    const orphans = Object.keys(SCREEN_ACCESS).filter(
      (k) => !ALL_NAV_KEYS.includes(k) && !OFF_SIDEBAR.includes(k),
    );
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
      // The club roster carries every member's email and phone number — it is
      // staff-only regardless of who is playing in the current tournament.
      "roster",
      "organization",
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
    // "week" is the league sheet — results, table and skins for one night. A
    // player sees it because it is the thing a league member came for; it is
    // read-only for every role, and the money is still managed on Prizes,
    // which stays staff-only.
    //
    // "rules" is the reference index: which published rule each decision this
    // app makes comes from. Deliberately open to players — the person most
    // likely to ask why a tie broke a particular way is the player it broke
    // against, and it carries no tournament data, only citations and links.
    //
    // "me" — the player shell they now land on at sign-in — is deliberately
    // absent: this list is drawn from the sidebar's keys, and the shell has
    // its own navigation and never appears there. It is covered by the
    // OFF_SIDEBAR list above instead.
    expect(allowed.sort()).toEqual(
      ["bracket", "dashboard", "entry", "leaderboard", "rules", "week"].sort(),
    );
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
  it("never shows a screen the guards would bounce", () => {
    // The invariant is one-directional: everything shown must be reachable.
    // The reverse does not hold, because some links are conditional on the
    // tournament (see the teams gate below) — showing fewer doors is safe,
    // showing one that bounces you is not.
    for (const role of ROLES) {
      const shown = navForRole(role, undefined, { hasTeamRound: true, hasKnockout: true }).flatMap((s) =>
        s.items.map((i) => i.key),
      );
      for (const key of shown) {
        expect(canAccessScreen(role, key), `sidebar offers ${key} to ${role} but the guard refuses`).toBe(true);
      }
    }
  });

  it("shows every unconditional screen a role may open", () => {
    // Guards against the opposite failure — a screen that exists, is allowed,
    // and is simply unreachable because nothing links to it.
    // Conditional on the tournament's shape rather than the role: teams only
    // once a round plays a team format, qualification only when there is a
    // knockout to qualify for.
    // ...and "This week" only once there is more than one round to be a week
    // of; a one-day medal would just have a second name for the leaderboard.
    const CONDITIONAL = ["teams", "qualification", "bracket", "week"];
    for (const role of ROLES) {
      const shown = navForRole(role, undefined, { hasTeamRound: true, hasKnockout: true }).flatMap((s) =>
        s.items.map((i) => i.key),
      );
      const allowed = ALL_NAV_KEYS.filter((k) => canAccessScreen(role, k) && !CONDITIONAL.includes(k));
      for (const key of allowed) {
        expect(shown, `${key} is allowed for ${role} but absent from the sidebar`).toContain(key);
      }
    }
  });

  it("hides Teams until a round is actually played by teams", () => {
    // Most tournaments never play a team format, and a permanent link to an
    // empty screen is clutter.
    const without = navForRole("admin").flatMap((s) => s.items.map((i) => i.key));
    const with_ = navForRole("admin", undefined, { hasTeamRound: true }).flatMap((s) =>
      s.items.map((i) => i.key),
    );
    expect(without).not.toContain("teams");
    expect(with_).toContain("teams");
  });

  it("hides This week until there is more than one week", () => {
    // Marking a link "conditional" in the list above excuses it from the
    // reachability check, so it needs its own proof that it appears at all —
    // otherwise CONDITIONAL is just where links go to quietly vanish.
    const medal = navForRole("admin").flatMap((s) => s.items.map((i) => i.key));
    const league = navForRole("admin", undefined, { isLeague: true }).flatMap((s) =>
      s.items.map((i) => i.key),
    );
    expect(medal).not.toContain("week");
    expect(league).toContain("week");
  });

  it("shows a league player their week", () => {
    // The whole point of the screen: a member of a Tuesday league opens the
    // app to find out what happened on Tuesday.
    const shown = navForRole("player", undefined, { isLeague: true }).flatMap((s) =>
      s.items.map((i) => i.key),
    );
    expect(shown).toContain("week");
  });

  it("never shows an empty section", () => {
    for (const role of ROLES) {
      for (const section of navForRole(role)) {
        expect(section.items.length, `empty section "${section.label}" for ${role}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("sidebar respects tournament settings", () => {
  const settings = (patch: Partial<TournamentSettings>): TournamentSettings => ({
    ...DEFAULT_SETTINGS,
    ...patch,
  });
  const keysFor = (role: Role, s: TournamentSettings) =>
    navForRole(role, s).flatMap((sec) => sec.items.map((i) => i.key));

  it("hides the leaderboard from players in a blind event", () => {
    const blind = settings({ leaderboardVisibility: "staff" });
    expect(keysFor("player", blind)).not.toContain("leaderboard");
    expect(keysFor("admin", blind)).toContain("leaderboard");
  });

  it("hides score entry from players when the organizer scores the event", () => {
    const staffScored = settings({ scoreEntryBy: "staff" });
    expect(keysFor("player", staffScored)).not.toContain("entry");
    expect(keysFor("admin", staffScored)).toContain("entry");
  });

  it("never leaves an empty section behind", () => {
    const locked = settings({ leaderboardVisibility: "staff", scoreEntryBy: "staff" });
    for (const role of ROLES) {
      for (const section of navForRole(role, locked)) {
        expect(section.items.length, `empty section "${section.label}" for ${role}`).toBeGreaterThan(0);
      }
    }
  });

  it("matches the unfiltered sidebar when settings are permissive", () => {
    const open = settings({ leaderboardVisibility: "participants", scoreEntryBy: "players" });
    for (const role of ROLES) {
      expect(keysFor(role, open)).toEqual(navForRole(role).flatMap((s) => s.items.map((i) => i.key)));
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

describe("qualification only appears when it has an answer", () => {
  it("is hidden when the tournament has no knockout", () => {
    // Its configuration moved into the round builder, so the screen's whole
    // remaining job is previewing who advances. With nothing to advance to it
    // reports "0 players qualify" on every tournament that simply ends at the
    // last round.
    const shown = navForRole("admin", undefined, { hasKnockout: false })
      .flatMap((s) => s.items)
      .map((i) => i.key);
    expect(shown).not.toContain("qualification");
  });

  it("appears once there is a knockout to qualify for", () => {
    const shown = navForRole("admin", undefined, { hasKnockout: true })
      .flatMap((s) => s.items)
      .map((i) => i.key);
    expect(shown).toContain("qualification");
  });

  it("stays reachable by URL, so an existing link never dead-ends", () => {
    // Hidden from the sidebar is not the same as forbidden — the guard is
    // still the role check, and a bookmarked link must still open.
    expect(canAccessScreen("admin", "qualification")).toBe(true);
  });
});

describe("the sidebar only offers screens with something on them", () => {
  it("hides Bracket when nothing feeds a knockout", () => {
    // The dashboard tile has been gated on this since it existed; the sidebar
    // link never was, so a weekly league carried a permanent door to an empty
    // bracket.
    const shown = navForRole("admin", undefined, { hasKnockout: false })
      .flatMap((s) => s.items)
      .map((i) => i.key);
    expect(shown).not.toContain("bracket");
    expect(shown).not.toContain("qualification");
  });

  it("shows both once a knockout exists", () => {
    const shown = navForRole("admin", undefined, { hasKnockout: true })
      .flatMap((s) => s.items)
      .map((i) => i.key);
    expect(shown).toContain("bracket");
    expect(shown).toContain("qualification");
  });

  it("no longer offers Scorecards, which the tee sheet absorbed", () => {
    // One entry point for printing cards, on the screen that owns the draw.
    const shown = navForRole("admin", undefined, { hasKnockout: true, hasTeamRound: true })
      .flatMap((s) => s.items)
      .map((i) => i.key);
    expect(shown).not.toContain("scorecard");
  });
});
