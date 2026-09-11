import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import { KNOCKOUT_STAGE_TYPES, hasKnockoutStage, isKnockoutRound } from "../stage-types";

/**
 * ONE RULE, WRITTEN OUT FOUR TIMES, WITH A FIFTH READER THAT NEVER LEARNED IT.
 *
 * "Does this tournament have a knockout in it" decides whether `/bracket` is
 * worth offering. `navForRole` gates the sidebar link on it — without that,
 * "every tournament carried a permanent door to an empty screen" — and
 * `ReportsClient` was given the same gate on 2026-09-10, after it was found
 * offering "Bracket sheet · Open the bracket, then print to PDF" on a one-round
 * charity day.
 *
 * The condition itself lived as a copied expression in four files: the console
 * layout, the dashboard, `standingRows` and the Reports screen. A rule with
 * four copies has no place to be corrected, and the "Recommended flow" card on
 * `/event` is what that costs — a fifth reader, telling a society league and a
 * club medal alike to go to a bracket they will never have.
 *
 * So the pair has one home now, and this file guards both halves: that nobody
 * spells it out again, and that the readers actually ask.
 */

const SRC = "src";

/** Every .ts/.tsx file under src, excluding tests — walked, never listed. */
function sourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      sourceFiles(rel, out);
    } else if (/\.tsx?$/.test(entry.name) && statSync(join(process.cwd(), rel)).isFile()) {
      out.push(rel);
    }
  }
  return out;
}

describe("what counts as a knockout", () => {
  it("is both halves of one, and nothing else", () => {
    // A Qualification Stage is a knockout's front half: it exists to seed a
    // bracket, and /bracket is where its audit lives. A round robin and a
    // medal round are what a league and a club championship are made of, and
    // neither ends in a draw.
    expect([...KNOCKOUT_STAGE_TYPES].sort()).toEqual(["Bracket Stage", "Qualification Stage"]);
    expect(isKnockoutRound("Bracket Stage")).toBe(true);
    expect(isKnockoutRound("Qualification Stage")).toBe(true);
    expect(isKnockoutRound("Round Robin")).toBe(false);
    expect(isKnockoutRound("Stroke Play Round")).toBe(false);
    expect(isKnockoutRound("Single Match Stage")).toBe(false);
    // An unknown type is not a knockout, which keeps a type nobody has taught
    // the app about off the bracket rather than silently onto it.
    expect(isKnockoutRound("Sudden Death Playoff")).toBe(false);
  });

  it("answers for a whole tournament", () => {
    expect(hasKnockoutStage([{ type: "Round Robin" }, { type: "Bracket Stage" }])).toBe(true);
    expect(hasKnockoutStage([{ type: "Round Robin" }, { type: "Stroke Play Round" }])).toBe(false);
    // A tournament with no rounds yet has no knockout — the state every
    // tournament is in for the minutes between creating it and sequencing it,
    // and the one /event is most often open in.
    expect(hasKnockoutStage([])).toBe(false);
  });
});

describe("who reads it", () => {
  it("keeps the pair of type names in one file", () => {
    /**
     * Absence, which is the safe direction and comment-proof under
     * `readSource` — the prose above `KNOCKOUT_STAGE_TYPES` names both types
     * and would satisfy a positive assertion happily.
     *
     * A file that spells the pair out again is a fifth copy, and the fifth
     * copy is the one that gets missed.
     */
    const offenders = sourceFiles().filter((f) => {
      if (f.endsWith(join("lib", "stage-types.ts"))) return false;
      const src = readSource(f);
      return /"Bracket Stage"\s*,\s*"Qualification Stage"/.test(src)
        || /"Bracket Stage"\s*(\|\||,)[\s\S]{0,60}"Qualification Stage"/.test(src);
    });
    expect(offenders, `spell out the knockout pair: ${offenders.join(", ")}`).toEqual([]);
  });

  it("sweeps a real number of files, so an empty walk cannot pass the check above", () => {
    // The count, for the reason screen-titles.test.ts asserts its own: a
    // sourceFiles() that returned nothing would make the sweep above green
    // and silent.
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain(join("src", "lib", "nav.ts"));
  });

  it("has /event ask the question rather than assume the answer", () => {
    /**
     * The screen this PR fixed. The card is in `EventSetupClient`; the fact is
     * only knowable on the server, so the page has to hand it over — and a
     * page that renders the component without the prop gets the old
     * behaviour, silently, because the default is true.
     */
    const page = readSource("src", "app", "(app)", "event", "page.tsx");
    expect(page).toMatch(/hasBracket=\{hasKnockoutStage\(state\.stages\)\}/);
  });

  it("has the flow card gate the step on it", () => {
    const card = readSource("src", "components", "EventSetupClient.tsx");
    // Anchored on the brace so a mention of `hasBracket` in a prop list cannot
    // satisfy this — the gate is what is being pinned, not the name.
    expect(card).toMatch(/\{hasBracket && <li>Bracket/);
  });

  it("leaves the screens that were already taught still asking", () => {
    // The regression half. These three had the rule before this change and
    // read a copied expression; they read the helper now, and must not have
    // quietly lost the condition in the swap.
    for (const [file, parts] of [
      ["reports", ["src", "app", "(app)", "reports", "page.tsx"]],
      ["dashboard", ["src", "app", "(app)", "dashboard", "page.tsx"]],
      ["standings", ["src", "lib", "services", "tournament.ts"]],
    ] as const) {
      expect(readSource(...parts), file).toMatch(/hasKnockoutStage\(/);
    }
    // And the sidebar, which asks it of the database rather than of a list.
    expect(readSource("src", "app", "(app)", "layout.tsx")).toMatch(
      /type:\s*\{\s*in:\s*\[\.\.\.KNOCKOUT_STAGE_TYPES\]\s*\}/,
    );
  });
});
