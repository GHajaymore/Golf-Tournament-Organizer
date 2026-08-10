import { describe, it, expect } from "vitest";
import { TOURNAMENT_TEMPLATES, templateFor, DEFAULT_TEMPLATE_KEY } from "../tournament-templates";
import { cleanSettings, DEFAULT_SETTINGS } from "../tournament-settings";
import { PLAYABLE_FORMAT_NAMES } from "../formats";
import { needsCourseData } from "../courses";

describe("template catalogue", () => {
  it("has unique keys", () => {
    const keys = TOURNAMENT_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every template's settings survive validation unchanged", () => {
    // A template that produced a value cleanSettings rejects would silently
    // become something other than what it says it is.
    for (const t of TOURNAMENT_TEMPLATES) {
      expect(cleanSettings(t.settings), `${t.key} settings are not all valid`).toEqual(t.settings);
    }
  });

  it("only uses formats an organizer can actually run", () => {
    // Playable, not merely scored: a template is a one-click setup, so it must
    // never drop someone into a round that can be configured but not scored.
    // This is the stricter of the two lists on purpose.
    for (const t of TOURNAMENT_TEMPLATES) {
      for (const r of t.rounds) {
        expect(PLAYABLE_FORMAT_NAMES, `${t.key} uses a format that can't be run yet`).toContain(
          r.format,
        );
      }
    }
  });

  it("uses a sane number of holes", () => {
    for (const t of TOURNAMENT_TEMPLATES) {
      for (const r of t.rounds) {
        expect([9, 18], `${t.key} has an odd hole count`).toContain(r.holes);
      }
    }
  });

  it("every template starts at least one round", () => {
    // A tournament with no rounds has nowhere to enter a score, and the
    // creation path builds exactly what the template lists.
    for (const t of TOURNAMENT_TEMPLATES) {
      expect(t.rounds.length, `${t.key} starts no rounds`).toBeGreaterThan(0);
    }
  });

  it("lays out a member-guest as five nine-hole matches", () => {
    // The shape of the event, not a detail of it: six pairs to a flight, each
    // playing the other five once. Building it by hand meant five trips
    // through the round builder, which is the assembly work that keeps clubs
    // on whatever they already use.
    const mg = TOURNAMENT_TEMPLATES.find((t) => t.key === "member-guest-rr")!;
    expect(mg.rounds).toHaveLength(5);
    expect(mg.rounds.every((r) => r.holes === 9)).toBe(true);
    expect(mg.rounds.every((r) => r.type === "Round Robin")).toBe(true);
    expect(mg.rounds[0].description).toContain("Match 1");
  });

  it("never leaves players with no way to sign in", () => {
    for (const t of TOURNAMENT_TEMPLATES) {
      if (t.settings.scoreEntryBy !== "players") continue;
      expect(["email", "code", "both"], `${t.key} locks players out`).toContain(t.settings.playerAccess);
    }
  });
});

describe("individual templates", () => {
  const byKey = (k: string) => TOURNAMENT_TEMPLATES.find((t) => t.key === k)!;

  it("club championship is blind, staff-scored and staff-approved together", () => {
    // These three come as a set in practice; a template that mixed them would
    // describe a tournament nobody runs.
    const t = byKey("club-championship");
    expect(t.settings.leaderboardVisibility).toBe("staff");
    expect(t.settings.scoreEntryBy).toBe("staff");
    expect(t.settings.scoreApproval).toBe("staff");
  });

  it("league round lets players score live and confirm between themselves", () => {
    const t = byKey("league-round");
    expect(t.settings.scoreEntryBy).toBe("players");
    expect(t.settings.scoreEntryWindow).toBe("during");
    expect(t.settings.scoreApproval).toBe("players");
  });

  it("league and charity templates offer a Round Code", () => {
    // A society or charity roster is often names and nothing else, so email
    // sign-in alone would strand the field on the day.
    for (const key of ["league-round", "charity-day"]) {
      expect(["code", "both"]).toContain(byKey(key).settings.playerAccess);
    }
  });

  it("member-guest and charity day are publicly watchable", () => {
    expect(byKey("member-guest").settings.leaderboardVisibility).toBe("public");
    expect(byKey("charity-day").settings.leaderboardVisibility).toBe("public");
  });

  it("charity day scores Stableford the way the engine models it", () => {
    // Stableford is a scoring basis, not a format: computeStandings keys off
    // scoringBasis while the format stays Stroke Play. Setting it as a format
    // would produce a round the format picker never offers.
    const t = byKey("charity-day");
    expect(t.rounds[0].format).toBe("Stroke Play");
    expect(t.rounds[0].scoringBasis).toBe("stableford");
  });

  it("a template may pick a team format, now that sides can actually be drawn", () => {
    // This used to forbid team formats outright, because they were named in
    // formats.ts with no team model behind them — a template choosing one was
    // a promise that broke on the first tee. Sides, team score entry and team
    // leaderboards all exist now, so the ban is lifted and replaced by the
    // condition that actually matters: whatever a template picks must be a
    // format the app can run end to end.
    for (const t of TOURNAMENT_TEMPLATES) {
      for (const r of t.rounds) {
        expect(PLAYABLE_FORMAT_NAMES, `${t.key} picks a format that can't be run`).toContain(
          r.format,
        );
      }
    }
    // And the member-guest round robin is the reason it was lifted.
    expect(byKey("member-guest-rr").rounds.every((r) => r.format === "Four-Ball")).toBe(true);
  });

  it("start-from-scratch is exactly the plain defaults", () => {
    expect(byKey("custom").settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe("course requirements implied by templates", () => {
  it("flags which templates will need a course before scoring", () => {
    // Gross match play needs none; anything scored against par does. This is
    // the difference between a league that can start with no venue and a
    // championship that cannot.
    const needs = (k: string) => {
      const t = TOURNAMENT_TEMPLATES.find((x) => x.key === k)!;
      return needsCourseData([{ format: t.rounds[0].format, scoringBasis: t.rounds[0].scoringBasis }]);
    };
    expect(needs("league-round")).toBe(false); // gross match play
    expect(needs("club-championship")).toBe(true); // stroke play
    expect(needs("member-guest")).toBe(true); // net match play
    expect(needs("charity-day")).toBe(true); // Stableford
  });
});

describe("templateFor", () => {
  it("resolves a known key", () => {
    expect(templateFor("league-round").key).toBe("league-round");
  });

  it("falls back rather than throwing on anything unknown", () => {
    // An old link or a typo must never block creating a tournament.
    expect(templateFor("no-such-template").key).toBe(DEFAULT_TEMPLATE_KEY);
    expect(templateFor(null).key).toBe(DEFAULT_TEMPLATE_KEY);
    expect(templateFor(undefined).key).toBe(DEFAULT_TEMPLATE_KEY);
    expect(templateFor("").key).toBe(DEFAULT_TEMPLATE_KEY);
  });
});
