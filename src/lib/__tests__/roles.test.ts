import { describe, it, expect } from "vitest";
import { ROLES, SCREEN_ACCESS, canAccessScreen, landingScreenFor, type Role } from "../roles";
import { NAV, navForRole } from "../nav";
import { DEFAULT_SETTINGS, type TournamentSettings } from "../tournament-settings";
import { readSource } from "./source";

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
    // "me" is the play shell they land on at sign-in. It is in the nav so that
    // staff who are ALSO in the field have a door into it, gated on actually
    // being entered — a player reaching it is simply reaching their own app.
    //
    // "messages" is open to players because a conversation only staff can
    // reach is the Announcements screen, which already exists separately and
    // stays staff-only. What a player sees inside is not decided here at all:
    // the screen shows the scopes their membership derives, so a player gets
    // their own flight, round, four and match and never the organizers'
    // thread — see domain/messaging.ts and messaging.audit.test.ts.
    //
    // "group-games" is the one screen here where a player can WRITE money, and
    // it is deliberate: a fourball's own skins is their $20, not the club's,
    // and needing the organizer to start it is why that game gets settled in a
    // group chat instead. The screen is navigation only — which pot a player
    // may actually write is decided by `requirePotAccess`, which allows the
    // group they are playing in, takes membership from the published tee sheet
    // rather than from the caller, and refuses the field's pot to anyone but
    // staff. Prizes & payouts, where the club's money lives, stays staff-only.
    expect(allowed.sort()).toEqual(
      [
        "bracket",
        "dashboard",
        "entry",
        "group-games",
        "leaderboard",
        "me",
        "messages",
        "rules",
        "week",
      ].sort(),
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
    // ...and "My round" only for someone who is actually in the field, which
    // is a fact about the person rather than about the tournament — an
    // organizer who does not play would only reach a screen saying so.
    const CONDITIONAL = ["teams", "bracket", "week", "me"];
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

describe("qualification is not a screen of its own", () => {
  /**
   * It was, and it was gated on `hasKnockout` — exactly the condition Bracket
   * is gated on, so the two appeared and vanished together. That is what gave
   * the merge away: two sidebar entries that are never separately available,
   * showing the same players, one as "who goes through" and the other as "who
   * they play". `/bracket`'s own subtitle already read "Seeded from
   * qualification".
   *
   * The audit now sits under the draw it seeds.
   */
  it("has no entry in the sidebar, with or without a knockout", () => {
    for (const hasKnockout of [true, false]) {
      const shown = navForRole("admin", undefined, { hasKnockout })
        .flatMap((s) => s.items)
        .map((i) => i.key);
      expect(shown, `hasKnockout: ${hasKnockout}`).not.toContain("qualification");
    }
  });

  it("has no access rule left behind", () => {
    // Same as `scoring` and `scorecard`, which are also redirects and also
    // absent from the map. A rule for a screen that no longer exists is a rule
    // nobody maintains.
    expect(canAccessScreen("admin", "qualification")).toBe(false);
  });

  it("did not hand its audience to somebody it was closed to", () => {
    /**
     * The rule it used to carry was admin and assistant only, while Bracket is
     * open to players. Merging a staff screen into a player-visible one is
     * exactly where an access rule gets lost, so this pins the half that
     * matters: a player still reaches the draw, and the panel that renders the
     * audit is guarded on `isStaff` at the call site.
     */
    expect(canAccessScreen("player", "bracket")).toBe(true);
    const page = readSource("src", "app", "(app)", "bracket", "page.tsx");
    expect(page).toMatch(/isStaff\s*$|isStaff\n/m);
    expect(page).toMatch(/qualification && <QualificationPanel/);
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
  });

  it("shows it once a knockout exists", () => {
    // One entry, not two. Qualification used to have its own beside this and
    // was gated on the very same condition — see "qualification is not a
    // screen of its own" above.
    const shown = navForRole("admin", undefined, { hasKnockout: true })
      .flatMap((s) => s.items)
      .map((i) => i.key);
    expect(shown).toContain("bracket");
    expect(shown).not.toContain("qualification");
  });

  it("no longer offers Scorecards, which the tee sheet absorbed", () => {
    // One entry point for printing cards, on the screen that owns the draw.
    const shown = navForRole("admin", undefined, { hasKnockout: true, hasTeamRound: true })
      .flatMap((s) => s.items)
      .map((i) => i.key);
    expect(shown).not.toContain("scorecard");
  });
});

describe("the play shell's door", () => {
  it("offers My round only to someone actually in the field", () => {
    // A conditional link excused from the reachability check needs its own
    // proof that it appears at all — CONDITIONAL is otherwise just where
    // links go to quietly vanish.
    const notPlaying = navForRole("admin").flatMap((s) => s.items.map((i) => i.key));
    const playing = navForRole("admin", undefined, { isPlayerToo: true }).flatMap((s) =>
      s.items.map((i) => i.key),
    );
    expect(notPlaying).not.toContain("me");
    expect(playing).toContain("me");
  });

  it("offers it to an assistant who plays too", () => {
    // Club golf is run by people playing in the thing they are running, and
    // that is as true of an assistant as of the organizer.
    const playing = navForRole("assistant", undefined, { isPlayerToo: true }).flatMap((s) =>
      s.items.map((i) => i.key),
    );
    expect(playing).toContain("me");
  });
});

describe("a match is not offered a field's screens", () => {
  const keys = (isMatch: boolean) =>
    navForRole("admin", undefined, { isMatch }).flatMap((s) => s.items.map((i) => i.key));

  it("drops the screens that only make sense against a field", () => {
    const tournament = keys(false);
    const match = keys(true);
    // Each of these is about running a FIELD: dividing one into flights,
    // drawing it a tee sheet, announcing to it, hiring staff to help. Two
    // people on the first tee have none of that.
    for (const gone of ["grouping", "foursomes", "announcements", "access"]) {
      expect(tournament).toContain(gone);
      expect(match).not.toContain(gone);
    }
  });

  it("drops the screens that belong to the CLUB rather than to this round", () => {
    const tournament = keys(false);
    const match = keys(true);
    /**
     * The half the set was not named after, and was still wide open.
     *
     * Walked on 2026-09-08, a Sunday fourball's sidebar offered Club settings,
     * Members and Season standings — the club's branding and colours, its
     * whole roster, and a league table for an event that is one round long and
     * can never be in a season. Those are not doors to somebody else's
     * problem; they are doors to somebody else's CLUB.
     *
     * `prizes` goes with them as the club's MONEY — a prize table, contests,
     * the float, the organizer's ledger. What it also carried, the skins pot,
     * is asserted below as having somewhere else to be.
     */
    for (const gone of ["organization", "roster", "series", "prizes"]) {
      expect(tournament, gone).toContain(gone);
      expect(match, gone).not.toContain(gone);
    }
  });

  it("keeps the screens a match genuinely has, including somewhere to bet", () => {
    const match = keys(true);
    /**
     * `registration` and `stages` USED TO BE ON THIS LIST, and the reason
     * given was right about the need and wrong about the door: "the field
     * screen stays because it is the only place a mistyped name or a wrong
     * handicap gets fixed; Rounds stays because changing 18 to 9 is exactly
     * the second thought two people have on the first tee."
     *
     * Both of those are real. What they produced was a fourball being walked
     * through a registration desk — approvals, a waitlist, a capacity, an
     * invite message — and a rounds screen with cut lines, carry-forward and
     * tiebreakers, to change one number. A casual round is not a small
     * tournament, and that walk is the thing this product is meant to be an
     * alternative to.
     *
     * They are `CasualRoundPanel` now: holes, shots and the handicaps, on the
     * round's own screen. The need is asserted there, and what stays here is
     * the round itself.
     */
    for (const kept of ["entry", "leaderboard"]) {
      expect(match, kept).toContain(kept);
    }
    for (const gone of ["registration", "stages", "event"]) {
      expect(match, gone).not.toContain(gone);
    }
    /**
     * THE ONE THAT MAKES THE REMOVAL ABOVE HONEST.
     *
     * A round played for a fiver is the oldest bet in golf, and dropping
     * `prizes` would have taken the skins pot with it — the one thing on that
     * screen a casual round actually wants. `group-games` is where players'
     * own money already lived and is where the round's pot renders now.
     *
     * Asserted here rather than left implied, because "we removed a screen"
     * and "we removed a capability" look identical in a nav test.
     */
    expect(match).toContain("group-games");
  });

  it("changes nothing for a tournament that did not ask", () => {
    // The flag defaults to absent, so every existing caller keeps the sidebar
    // it had. Compared against the no-options call rather than against a
    // written-out list, which would drift.
    expect(keys(false)).toEqual(navForRole("admin").flatMap((s) => s.items.map((i) => i.key)));
  });

  it("stays reachable by URL, so a link into a match never dead-ends", () => {
    // Hidden from the sidebar is not forbidden — same rule as Qualification.
    expect(canAccessScreen("admin", "grouping")).toBe(true);
  });
});
