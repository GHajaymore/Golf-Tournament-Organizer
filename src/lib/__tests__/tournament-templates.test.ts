import { describe, it, expect } from "vitest";
import { TOURNAMENT_TEMPLATES, templateFor, DEFAULT_TEMPLATE_KEY } from "../tournament-templates";
import { cleanSettings, DEFAULT_SETTINGS } from "../tournament-settings";
import { SCORED_FORMAT_NAMES } from "../formats";
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

  it("only uses formats the app can actually score", () => {
    // formats.ts lists team formats with no team model behind them. A
    // template picking one would promise something that breaks on the first
    // tee, so every template must stay inside the scored set.
    for (const t of TOURNAMENT_TEMPLATES) {
      expect(SCORED_FORMAT_NAMES, `${t.key} uses an unscoreable format`).toContain(t.round.format);
    }
  });

  it("uses a sane number of holes", () => {
    for (const t of TOURNAMENT_TEMPLATES) {
      expect([9, 18], `${t.key} has an odd hole count`).toContain(t.round.holes);
    }
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
    expect(t.round.format).toBe("Stroke Play");
    expect(t.round.scoringBasis).toBe("stableford");
  });

  it("no template picks a team format while there is no team model", () => {
    for (const t of TOURNAMENT_TEMPLATES) {
      expect(t.round.format, `${t.key} picks a team format`).not.toMatch(
        /scramble|best ball|four-?ball|shamble|foursomes|alternate shot/i,
      );
    }
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
      return needsCourseData([{ format: t.round.format, scoringBasis: t.round.scoringBasis }]);
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
