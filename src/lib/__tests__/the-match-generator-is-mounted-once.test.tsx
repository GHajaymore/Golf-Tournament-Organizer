import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource, stripComments } from "./source";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
function actionModule() {
  return new Proxy({}, { get: (_t, key) => (typeof key === "string" && key !== "then" ? async () => ({ ok: true }) : undefined) }) as Record<string, unknown>;
}
vi.mock("@/app/actions/teams", actionModule);
vi.mock("@/app/actions/tournament", actionModule);

import { TeamsClient } from "@/components/TeamsClient";
import { matchGeneratorPlace, type DrawRound } from "@/lib/domain/draw-sections";
import type { Family } from "@/lib/domain/tournament-status";

/**
 * "GENERATE MATCHES" IS DRAWN ON EXACTLY ONE SCREEN (R9b; CLAUDE.md, the old screen obeys the same boolean).
 *
 * The control left `TeamsClient` for `TeamMatchesControl`, which Tee times & draw mounts too once it builds the
 * round. One boolean, `matchGeneratorPlace`, decides where; this counts the mounts across every family and
 * both states of the switch, on the real Teams screen, so a round is never offered it twice and never by neither.
 */

const FAMILIES: Family[] = ["stroke", "stableford", "match", "roundRobinFlights", "knockout", "flightedKnockout", "teamCup", "league", "casual"];
const ROUND: DrawRound = { type: "Round Robin", format: "Four-Ball", hasSavedSheet: false };
const format = {
  name: "Four-Ball", desc: "", min: 2, max: 2, sharesOneCard: false, allowance: 90, recommendedAllowance: 90,
  allowanceOverridden: false, allowanceIsConvention: false, shares: null, recommendedShares: null, sharesOverridden: false,
  countBest: 1, countBestOverridden: false, maxCountBest: 2,
};
const sides = [
  { id: "t1", name: "Side A", seed: 1, stageId: "r1", playingHandicap: 14, members: [] },
  { id: "t2", name: "Side B", seed: 2, stageId: "r1", playingHandicap: 12, members: [] },
];
const teamsScreen = (matchesHere: boolean, drawsMatches = true) =>
  renderToStaticMarkup(
    <TeamsClient
      matchesHere={matchesHere}
      rounds={[{ id: "r1", label: "R1", format: "Four-Ball" }]}
      activeRoundId="r1"
      format={format}
      teams={sides}
      problems={[]}
      unassigned={[]}
      matchCount={0}
      drawsMatches={drawsMatches}
    />,
  );
const mounts = (html: string) => html.split("data-team-matches").length - 1;

describe("the match generator is mounted once", () => {
  it("Teams draws it while matchesHere is false and a round draws matches, and not otherwise", () => {
    expect(mounts(teamsScreen(false))).toBe(1);
    expect(mounts(teamsScreen(true))).toBe(0);
    expect(mounts(teamsScreen(false, false))).toBe(0);
    expect(mounts(teamsScreen(true, false))).toBe(0);
  });

  it("across every family and both switch states, Teams plus Tee times & draw draw it exactly once", () => {
    for (const family of FAMILIES) {
      for (const teeTimesShown of [false, true]) {
        const place = matchGeneratorPlace(ROUND, family, teeTimesShown);
        const onTeams = mounts(teamsScreen(place === "teeTimes"));
        const onTeeTimes = place === "teeTimes" ? 1 : 0;
        expect(onTeams + onTeeTimes, `${family}, teeTimes ${teeTimesShown ? "shown" : "off"}`).toBe(1);
      }
    }
  });

  it("the old screen obeys the same boolean: with the switch off the generator stays on Teams for every family", () => {
    for (const family of FAMILIES) expect(matchGeneratorPlace(ROUND, family, false), family).toBe("teams");
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
      } else if (/\.tsx$/.test(name) && /<TeamMatchesControl\b/.test(stripComments(readFileSync(p, "utf8")))) {
        out.push(p.slice(SRC.length + 1).replace(/\\/g, "/"));
      }
    }
    return out;
  }

  it("only Teams (through TeamsClient) and Tee times & draw mount the control", () => {
    expect(mountSites(SRC).sort()).toEqual(["app/(app)/foursomes/page.tsx", "components/TeamsClient.tsx"]);
  });

  it("each page's boolean is `matchGeneratorPlace`, and the Tee times mount is behind it", () => {
    const teams = readSource("src", "app", "(app)", "teams", "page.tsx");
    expect(teams).toMatch(/matchGeneratorPlace\(/);
    expect(teams).toMatch(/matchesHere=\{matchesHere\}/);
    const tee = readSource("src", "app", "(app)", "foursomes", "page.tsx");
    expect(tee).toMatch(/matchGeneratorPlace\([^)]*true\) === "teeTimes"/);
    expect(tee).toMatch(/\{generatorHere && \(\s*<TeamMatchesControl/);
  });
});
