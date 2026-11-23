import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./source";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => <a href={href} {...rest}>{children as never}</a> }));

const { PLAYER_TABS, playerTabsFor, playerTabHref, previewQuery, cupTeamsHome } = await import("@/lib/domain/players-tabs");
const { PlayersTabs } = await import("@/components/players/PlayersTabs");
const { REDESIGN_GUIDE } = await import("@/lib/guide/redesign");

/**
 * THE PLAYERS ROOM (R6): which tabs a tournament lists, where a tab's link goes, and that the cup's two teams
 * are drawn in exactly ONE place for every state of the switch. Worked by hand from the design, not from the code.
 */

describe("the tabs a tournament lists", () => {
  const keys = (hasTeamRound: boolean, hasCup: boolean) => playerTabsFor({ hasTeamRound, hasCup }).map((t) => t.key);
  it("a plain stroke event: Entries and Flights", () => {
    expect(keys(false, false)).toEqual(["entries", "flights"]);
  });
  it("a team round adds Teams", () => {
    expect(keys(true, false)).toEqual(["entries", "flights", "teams"]);
  });
  it("a cup adds Cup teams, and a cup of four-balls lists both", () => {
    expect(keys(false, true)).toEqual(["entries", "flights", "cup"]);
    expect(keys(true, true)).toEqual(["entries", "flights", "teams", "cup"]);
  });
  it("every tab asks its own lock: field, flights, sides, cup", () => {
    expect(PLAYER_TABS.map((t) => t.scope)).toEqual(["field", "flights", "sides", "cup"]);
  });
});

describe("a tab's address", () => {
  const cup = PLAYER_TABS.find((t) => t.key === "cup")!;
  const entries = PLAYER_TABS.find((t) => t.key === "entries")!;
  it("stays inside the preview, and drops everything else the request carried", () => {
    expect(playerTabHref(entries, "stepper=1&build=1&round=abc")).toBe("/registration?stepper=1&build=1");
  });
  it("keeps the tab's own query first", () => {
    expect(playerTabHref(cup, "stepper=1&build=1")).toBe("/teams?tab=cup&stepper=1&build=1");
  });
  it("outside a preview it is the bare address", () => {
    expect(playerTabHref(entries, "")).toBe("/registration");
    expect(previewQuery("round=abc").toString()).toBe("");
  });
});

describe("the tab strip", () => {
  it("marks exactly the current tab, and links every listed tab", () => {
    const html = renderToStaticMarkup(<PlayersTabs tabs={playerTabsFor({ hasTeamRound: true, hasCup: true })} active="teams" search="stepper=1&build=1" />);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Teams<\/a>/);
    for (const label of ["Entries", "Flights", "Teams", "Cup teams"]) expect(html).toContain(`>${label}</a>`);
    expect(html).toContain('href="/teams?tab=cup&amp;stepper=1&amp;build=1"');
  });
});

describe("the cup's teams have ONE home (mounted once)", () => {
  it("for each state of the switch, exactly one of the two places draws them", () => {
    for (const playersShown of [true, false]) {
      const home = cupTeamsHome(playersShown);
      const cupPageDraws = home === "cup";
      const playersTabDraws = home === "players";
      expect([cupPageDraws, playersTabDraws].filter(Boolean), `players shown: ${playersShown}`).toHaveLength(1);
    }
    expect(cupTeamsHome(true)).toBe("players");
    expect(cupTeamsHome(false)).toBe("cup");
  });

  const root = join(process.cwd(), "src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      if (n === "__tests__") return [];
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });
  const mounting = (name: string) =>
    files(root)
      .filter((f) => new RegExp(`<${name}\\b`).test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => f.slice(root.length + 1).replace(/\\/g, "/"))
      .sort();

  it("only the cup page and the Cup teams tab mount CupTeams and CreateCupTeams", () => {
    expect(mounting("CupTeams")).toEqual(["app/(app)/cup/page.tsx", "components/players/CupTeamsTab.tsx"]);
    expect(mounting("CreateCupTeams")).toEqual(["app/(app)/cup/page.tsx", "components/players/CupTeamsTab.tsx"]);
  });

  it("the cup page mounts them only on `teamsHere`, and the teams page draws the tab only when the home is Players", () => {
    const cup = stripComments(readFileSync(join(root, "app/(app)/cup/page.tsx"), "utf8"));
    expect(cup).toMatch(/teamsHere \? \(\s*<CreateCupTeams/);
    expect(cup).toMatch(/\{teamsHere \? \(\s*<CupTeams/);
    expect(cup).toContain('cupTeamsHome(playersShown) === "cup"');
    const teams = stripComments(readFileSync(join(root, "app/(app)/teams/page.tsx"), "utf8"));
    expect(teams).toContain('cupTeamsHome(true) === "players"');
    expect(teams.match(/<CupTeamsTab/g)).toHaveLength(1);
  });
});

describe("the guide's Players variant", () => {
  it("is registered for the players key and replaces nothing", () => {
    const v = REDESIGN_GUIDE.filter((g) => g.screen === "players");
    expect(v).toHaveLength(1);
    expect(v[0].replaces).toEqual([]);
    expect(v[0].sections.length).toBeGreaterThan(0);
  });
});
