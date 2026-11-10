import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamStandingsTable } from "@/components/TeamLeaderboard";
import type { TeamStanding } from "@/lib/services/teams";
import { tournamentTerms } from "../rules";
import { FORMAT_NAMES, findFormat, needsTeams } from "../formats";
import { STAGE_TYPES } from "../stage-types";
import { recommendedAllowance, teamAllowanceWords, playingHandicapInRound } from "../round-allowance";
import { courseHandicapExact } from "../domain/handicap";
import { readSource } from "./source";

/**
 * WHAT A TEAM ROUND TELLS ITS PLAYERS ABOUT HANDICAP (backlog J21 and J23).
 *
 * J23. A four-ball board printed a "H/cap" figure for each side that nobody
 * plays off: 90% of the pair's combined handicaps, from `sidePlayingHandicap`'s
 * flat branch. In a four-ball every player plays their own ball off their own
 * playing handicap (Rules of Handicapping, Appendix C: 85% of EACH player's
 * course handicap at stroke play, 90% in a match), and the side's score is the
 * better ball. There is no team handicap to print. So an own-ball board prints
 * each player's own figure, and only a shared-ball board (foursomes,
 * greensomes, a scramble) prints the side's, because there the side IS the
 * player.
 *
 * J21. The rules sheet stated a team round's allowance only when a committee had
 * set one, and then as "60% of course handicap" whatever the format. It now
 * always says the allowance in force and whose it is, from
 * `recommendedAllowance(format, stage.type)`.
 */

const rule = {
  format: "Four-Ball",
  type: "Stroke Play Round",
  holes: 18,
  scoringBasis: "net",
  handicapAllowance: 0,
  countBest: 0,
  tiebreakers: [],
  cutAfter: null,
  carryForwardEnabled: false,
  carryForwardPct: 0, netCountback: "fractions" as const,
};
const sheet = (over: Partial<Parameters<typeof tournamentTerms>[0]> = {}) =>
  tournamentTerms({ ...rule, ...over }).find((t) => t.label === "Handicap allowance")?.value;

describe("J21: the rules sheet always states a team round's allowance", () => {
  it("a four-ball medal says 85% of each player's course handicap, the Rules' figure", () => {
    expect(sheet()).toBe("85% of each player's handicap, the Rules' figure");
  });

  it("a four-ball MATCH says 90% (Appendix C), asked of the round's type", () => {
    expect(sheet({ type: "Round Robin" })).toBe("90% of each player's handicap, the Rules' figure");
  });

  it("foursomes says 50% of the pair's combined handicaps", () => {
    expect(sheet({ format: "Foursomes" })).toBe("50% of the side's combined handicaps, the Rules' figure");
  });

  it("greensomes and scrambles say their split, not a flat percentage", () => {
    expect(sheet({ format: "Greensomes" })).toBe(
      "60% lower, 40% higher handicap, the Rules' figure",
    );
    expect(sheet({ format: "Scramble" })).toBe(
      "Lowest handicap first. Two: 35 / 15. Three: 30 / 20 / 10. Four: 25 / 20 / 15 / 10. The Rules' figure.",
    );
  });

  it("a club convention is said to be one", () => {
    expect(sheet({ format: "Shamble" })).toBe("85% of each player's handicap, club convention, not the Rules");
  });

  it("a committee's flat figure is said to be the committee's, and what it replaced", () => {
    expect(sheet({ handicapAllowance: 80 })).toBe("80% of each player's handicap, set by the committee");
    expect(sheet({ handicapAllowance: 85 })).toBe("85% of each player's handicap: the committee's, same as the Rules");
    expect(sheet({ format: "Foursomes", handicapAllowance: 60 })).toBe(
      "60% of the side's combined handicaps, set by the committee",
    );
  });

  it("a committee's own split is said to be the committee's", () => {
    expect(sheet({ format: "Greensomes", allowanceWeights: [55, 45] })).toBe(
      "55% lower, 45% higher handicap, set by the committee",
    );
  });

  it("EVERY team format on EVERY kind of round states one, and its percentage is the resolver's", () => {
    let checked = 0;
    for (const format of FORMAT_NAMES) {
      if (!needsTeams(format)) continue;
      for (const type of STAGE_TYPES) {
        const value = sheet({ format, type });
        expect(value, `${format} / ${type} states no allowance`).toBeTruthy();
        const f = findFormat(format);
        if (!f.weightsBySideSize) expect(value).toContain(`${recommendedAllowance(format, type)}%`);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20); // CONTROL: the loop looked at something
  });

  it("Best Ball does not claim the Rules for a figure they give only to a pair at stroke play", () => {
    expect(sheet({ format: "Best Ball" })).toBe(
      "85% of each player's handicap. The app's default; the Rules' for a pair at stroke play.",
    );
    expect(sheet({ format: "Best Ball" })).not.toContain("the Rules' figure");
  });

  it("a split stored on a four-ball is not stated: the scoring ignores it", () => {
    expect(sheet({ allowanceWeights: [55, 45] })).toBe("85% of each player's handicap, the Rules' figure");
    expect(sheet({ handicapAllowance: 80, allowanceWeights: [55, 45] })).toBe(
      "80% of each player's handicap, set by the committee",
    );
  });

  it("a PLAYER'S screen allows no sentence of 12 words or more and no block of 25 (e2e/player-words.spec.ts)", () => {
    // The first draft of these words failed that spec on a league member's Rules screen.
    const words = (s: string) => s.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    let looked = 0;
    for (const format of FORMAT_NAMES) {
      if (!needsTeams(format)) continue;
      for (const type of STAGE_TYPES) {
        for (const over of [{}, { handicapAllowance: 80 }, { handicapAllowance: 85 }, { allowanceWeights: [55, 45] }]) {
          const value = sheet({ format, type, ...over })!;
          const longest = Math.max(...value.split(/(?<=[.!?])\s+/).map(words));
          expect(longest, `"${value}" has a sentence of ${longest} words`).toBeLessThan(12);
          expect(words(value), `"${value}" is a block of ${words(value)} words`).toBeLessThan(25);
          looked++;
        }
      }
    }
    expect(looked).toBeGreaterThan(80);
  });

  it("an individual round still says its own line, unchanged", () => {
    expect(sheet({ format: "Stroke Play" })).toBe("95% of course handicap");
  });

  it("the words are written once: the sheet reads teamAllowanceWords", () => {
    expect(readSource("src/lib/rules.ts")).toMatch(/teamAllowanceWords\(/);
    expect(teamAllowanceWords({ format: "Foursomes", type: "Stroke Play Round", handicapAllowance: 0, allowanceWeights: [] })).toMatch(/^50%/);
  });
});

/** A side as `teamStandings` hands it to the board. */
const side = (over: Partial<TeamStanding>): TeamStanding => ({
  teamId: "t1",
  name: "zz-Ann & zz-Bob",
  members: ["zz-Ann", "zz-Bob"],
  memberIds: ["a", "b"],
  memberPlaying: [8, 10],
  playingHandicap: 17,
  gross: 70,
  net: 62,
  points: 0,
  played: 18,
  toPar: -2,
  place: 1,
  ...over,
});
const board = (rows: TeamStanding[], basis: "net" | "gross" | "stableford" = "net") =>
  renderToStaticMarkup(createElement(TeamStandingsTable, { basis, rows }));
/** The text inside some markup: a scan, not a pattern, so nothing half-stripped can be left behind. */
const textOf = (s: string): string => {
  let out = "";
  let inTag = false;
  for (const ch of s) {
    if (ch === "<") inTag = true;
    else if (ch === ">") inTag = false;
    else if (!inTag) out += ch;
  }
  return out;
};
/** The text of the H/cap column's cell in the first body row. */
const handicapCell = (html: string) => {
  const row = html.match(/<tbody>.*?<\/tr>/s)![0];
  return [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => textOf(m[1]))[2];
};

describe("J23: a team board prints a handicap somebody plays off", () => {
  it("a four-ball prints each player's own figure and NOT the made-up side figure", () => {
    const html = board([side({})]);
    expect(handicapCell(html)).toBe("8 · 10");
    expect(html).not.toMatch(/>17</);
    expect(html).toContain("Plays off");
  });

  it("a foursomes prints the side's figure, because the side is the player", () => {
    const html = board([side({ memberPlaying: [null, null], playingHandicap: 17 })]);
    expect(handicapCell(html)).toBe("17");
    expect(html).toContain("H/cap");
  });

  it("a side with nobody on it prints a dash on an own-ball board, never 0", () => {
    const html = board([side({}), side({ teamId: "t2", members: [], memberIds: [], memberPlaying: [], playingHandicap: 0, played: 0, place: null })]);
    const rows = [...html.matchAll(/<tr>.*?<\/tr>/gs)].map((m) => m[0]);
    const empty = [...rows[2].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => textOf(m[1]));
    expect(empty[2]).toBe("—");
  });

  it("the help under an own-ball board does not talk about a side's handicap", () => {
    const html = board([side({})]);
    expect(html).not.toContain("the side&#x27;s gross minus the handicap strokes it receives");
    expect(html).toContain("own strokes off their own ball");
  });

});

describe("the figure each player plays off, worked from the Rules by another route", () => {
  /**
   * The USGA's own example (Rules of Handicapping, Appendix C, four-ball at 85%):
   * 8.6 and 10.3 off a 71.0/125 tee at par 71 play off 8 and 10. Worked here in
   * whole thousandths so it shares neither the code's formula nor its floating
   * point: course handicap = index x slope / 113 (+ rating - par, nil here),
   * x 85 / 100, rounded ONCE, half up. Rounding the course handicap first (9, 11)
   * gives 8 and 9 and is the fault `docs/claude/handicaps-and-tees.md` records.
   */
  const rulesPlaying = (indexTenths: number, slope: number, pct: number) =>
    // indexTenths/10 * slope/113 * pct/100, half up, in integers
    Math.floor((indexTenths * slope * pct * 2 + 10 * 113 * 100) / (2 * 10 * 113 * 100));

  it("the Rules' answer is 8 and 10 (CONTROL for the route below)", () => {
    expect(rulesPlaying(86, 125, 85)).toBe(8);
    expect(rulesPlaying(103, 125, 85)).toBe(10);
  });

  it("the resolver the board reads gives the Rules' 8 and 10, not 8 and 9", () => {
    const tee = { slopeRating: 125, courseRating: 71, par: 71 };
    const round = { format: "Four-Ball", type: "Stroke Play Round", scoringBasis: "net", handicapAllowance: 0 };
    const playing = (index: number) => {
      const exact = courseHandicapExact(index, tee);
      return playingHandicapInRound(round, null, { whole: Math.round(exact), exact, parStrokes: 0 });
    };
    expect(playing(8.6)).toBe(rulesPlaying(86, 125, 85));
    expect(playing(10.3)).toBe(rulesPlaying(103, 125, 85));
    expect([playing(8.6), playing(10.3)]).toEqual([8, 10]);
  });
});
