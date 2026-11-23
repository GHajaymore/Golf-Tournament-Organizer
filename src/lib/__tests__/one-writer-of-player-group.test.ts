import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./source";
import { unplacedPlacedOn } from "@/lib/domain/players-tabs";
import type { Family } from "@/lib/domain/tournament-status";

/**
 * A PLAYER'S FLIGHT (OR A CUP TEAM) IS WRITTEN BY A NAMED FEW, AND EACH DOOR HAS ONE SCREEN (R6).
 *
 * `Player.groupId` is the flight, and in a cup it is the team. The Players room splits the acts: a player is MOVED between
 * flights on Flights, an UNPLACED one is put in a flight where the late entry was taken (Entries), and in a cup on Cup teams.
 * This is the sweep that holds the split: a new writer of the column is a new door, and a new door needs a ruling.
 */

const root = join(process.cwd(), "src");
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "__tests__") return [];
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
const rel = (p: string) => p.slice(root.length + 1).replace(/\\/g, "/");

/** Every `prisma|tx .player.<write>(` whose next lines write `groupId`: "file: function". */
function writers(): string[] {
  const found: string[] = [];
  for (const dir of ["app/actions", "lib/services"]) {
    for (const f of sources(join(root, dir))) {
      const text = stripComments(readFileSync(f, "utf8"));
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!/\.player\.(update|updateMany|create|createMany|upsert)\(/.test(line)) return;
        const block = lines.slice(i, i + 14).join("\n");
        if (!/\bgroupId\b/.test(block)) return;
        let name = "(top level)";
        for (let j = i; j >= 0; j--) {
          const m = lines[j].match(/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
          if (m) {
            name = m[1];
            break;
          }
        }
        found.push(`${rel(f)}: ${name}`);
      });
    }
  }
  return [...new Set(found)].sort();
}

/** Each writer, and the field change or scope it asks. */
const ALLOWED: Readonly<Record<string, string>> = {
  "app/actions/tournament.ts: intoFlight": "move-flight / place-in-flight (the one field rule)",
  "app/actions/tournament.ts: addSignup": "add-to-flight (the add form's flight)",
  "app/actions/cup.ts: setCupPlayerTeam": "the cup scope and the lineup check",
  "app/actions/match-setup.ts: createMatch": "a head-to-head match's own carrier flight, for the player it makes",
  "app/actions/tee-sheet.ts: replaceInTeeSheet": "a guest made to stand in for an absentee, in the absentee's club group",
  "lib/services/regroup.ts: regenerateGroupsAndSchedule": "flights, through regenGroups",
  "lib/services/regroup.ts: generateCutRound": "the cut's flights (a cut round's own)",
};

describe("who writes Player.groupId", () => {
  it("the allow-list is not empty and names the flight mover", () => {
    expect(Object.keys(ALLOWED).length).toBeGreaterThan(0);
    expect(Object.keys(ALLOWED)).toContain("app/actions/tournament.ts: intoFlight");
  });

  it("every writer is one named here, and every name here still writes", () => {
    expect(writers()).toEqual(Object.keys(ALLOWED).sort());
  });

  const importers = (action: string): string[] =>
    sources(root)
      .filter((f) => /\.tsx$/.test(f))
      .filter((f) => new RegExp(`import\\s*\\{[^}]*\\b${action}\\b[^}]*\\}\\s*from\\s*"@/app/actions/`).test(stripComments(readFileSync(f, "utf8"))))
      .map(rel)
      .sort();

  it("each door's action is imported by exactly one component", () => {
    expect(importers("placeInFlight")).toEqual(["components/RegistrationClient.tsx"]);
    expect(importers("movePlayerToGroup")).toEqual(["components/FlightBoard.tsx"]);
    expect(importers("setCupPlayerTeam")).toEqual(["components/CupTeams.tsx"]);
  });
});

describe("where an unplaced player is put, while Players is shown", () => {
  // The nine families, worked by hand: only a cup moves the act to Cup teams.
  const families: Record<Family, "entries" | "cup-teams"> = {
    stroke: "entries",
    stableford: "entries",
    match: "entries",
    roundRobinFlights: "entries",
    knockout: "entries",
    flightedKnockout: "entries",
    teamCup: "cup-teams",
    league: "entries",
    casual: "entries",
  };
  for (const [family, home] of Object.entries(families) as [Family, "entries" | "cup-teams"][]) {
    it(`${family}: ${home} when shown, Entries when the switch is off`, () => {
      expect(unplacedPlacedOn(true, family)).toBe(home);
      expect(unplacedPlacedOn(false, family)).toBe("entries");
    });
  }
});
