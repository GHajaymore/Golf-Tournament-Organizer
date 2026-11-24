import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { drawControlsOf, leagueDrawPlace, drawSections, type DrawRound } from "@/lib/domain/draw-sections";
import type { Family } from "@/lib/domain/tournament-status";
import { readSource, stripComments } from "./source";

/**
 * AN INTERCLUB LEAGUE'S "DRAW THIS WEEK" IS DRAWN ON EXACTLY ONE SCREEN (B110; the TD's ruling of 23 Nov; CLAUDE.md,
 * the old screen obeys the same boolean).
 *
 * The week's four-balls are a weekly job, so they moved from Teams & pairs (`LeagueSection`) to the draw section of Tee
 * times & draw once that screen is shown and builds the round. `leagueDrawPlace` is the one answer; `LeagueSection` hides
 * its `LeagueDraw` while it says "teeTimes" and the Tee times page mounts it only then. Nominating pairs stays on Teams.
 *
 * The Tee times side is the page's own mount (a server page that reads the database), so the counts below are worked from
 * the place function and the source checks hold each mount to it.
 */

const FAMILIES: Family[] = ["stroke", "stableford", "match", "roundRobinFlights", "knockout", "flightedKnockout", "teamCup", "league", "casual"];
const ROUND: DrawRound = { type: "Round Robin", format: "Four-Ball", hasSavedSheet: false };

describe("Draw this week is mounted once", () => {
  it("for every family and both switch states, Teams plus Tee times & draw mount it exactly once", () => {
    for (const family of FAMILIES) {
      for (const teeTimesShown of [false, true]) {
        const place = leagueDrawPlace(ROUND, family, teeTimesShown);
        // LeagueSection draws LeagueDraw unless `drawMoved`; the Tee times page draws it only while it builds the round.
        const onTeams = place === "teams" ? 1 : 0;
        // The Tee times page is only rendered while it is shown AND built, which is when `place` is "teeTimes".
        const onTeeTimes = place === "teeTimes" && teeTimesShown && drawSections(ROUND, family).built ? 1 : 0;
        expect(onTeams + onTeeTimes, `${family}, Tee times ${teeTimesShown ? "shown" : "off"}`).toBe(1);
      }
    }
  });

  it("with the switch off, the week is drawn on Teams for every family (the old screen is unchanged)", () => {
    for (const family of FAMILIES) expect(leagueDrawPlace(ROUND, family, false), family).toBe("teams");
  });

  it("only a league on, and a round of pairs, has the control; absent `league` means none", () => {
    const live = { launched: true, isFirst: false, completed: false };
    expect(drawControlsOf(ROUND, { ...live, league: true }).leagueWeek).toBe(true);
    expect(drawControlsOf(ROUND, { ...live, league: false }).leagueWeek).toBe(false);
    expect(drawControlsOf(ROUND, live).leagueWeek).toBe(false);
    expect(drawControlsOf({ type: "Stroke Play Round", format: "Stroke Play" }, { ...live, league: true }).leagueWeek, "a round of individuals has no pairs to draw").toBe(false);
    // It is a weekly job: asked in the first week, and while the league is only being set up.
    expect(drawControlsOf(ROUND, { launched: false, isFirst: true, completed: false, league: true }).leagueWeek).toBe(true);
  });
});

describe("the two pages ask the one answer", () => {
  const SRC = join(process.cwd(), "src");
  function mountSites(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === "__tests__") continue;
        mountSites(p, out);
      } else if (/\.tsx$/.test(name) && /<LeagueDraw\b/.test(stripComments(readFileSync(p, "utf8")))) {
        out.push(p.slice(SRC.length + 1).replace(/\\/g, "/"));
      }
    }
    return out;
  }

  it("only LeagueSection (Teams) and Tee times & draw mount LeagueDraw", () => {
    expect(mountSites(SRC).sort()).toEqual(["app/(app)/foursomes/page.tsx", "components/LeagueSection.tsx"]);
  });

  it("Teams hides its LeagueDraw exactly while `drawMoved`, which the page takes from `leagueDrawPlace`", () => {
    const section = readSource("src", "components", "LeagueSection.tsx");
    expect(section).toMatch(/\{drawMoved \? \(/);
    expect(section).toMatch(/\) : \(\s*<LeagueDraw stageId=\{stageId\} drawn=\{drawn\} \/>\s*\)\}/);
    const teams = readSource("src", "app", "(app)", "teams", "page.tsx");
    expect(teams).toMatch(/leagueDrawPlace\(roundForPlace, told\.status\.family, teeTimesShown\) === "teeTimes"/);
    expect(teams).toMatch(/drawMoved=\{leagueDrawMoved\}/);
  });

  it("Tee times & draw mounts it in the draw section, behind the same place function, for staff, a league with clubs", () => {
    const tee = readSource("src", "app", "(app)", "foursomes", "page.tsx");
    expect(tee).toMatch(/isStaff && controls\.leagueWeek \? await flightsIn\(/);
    expect(tee).toMatch(/leagueClubs\.length > 0 && leagueDrawPlace\([^)]*true\) === "teeTimes"/);
    expect(tee).toMatch(/<LeagueDraw stageId=\{stage\.id\} drawn=\{roundMatches\} \/>/);
    expect(tee).toMatch(/league: isLeaguePointsSystem\(state\.event\.leaguePoints\)/);
    // In the draw section, once, and says where the pairs are nominated.
    expect(tee.split("{leagueWeekPointer}").length - 1).toBe(1);
    expect(tee).toContain("data-league-pairs-pointer");
    expect(tee).toContain("/teams?round=${stage.id}");
  });
});
