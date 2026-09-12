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
  it("is the bracket, and nothing else", () => {
    /**
     * ONE TYPE SINCE 2026-09-11. A "Qualification Stage" used to count as a
     * knockout's front half — it existed to seed a bracket — and it was
     * removed: it was the only type the field never played, its one control
     * wrote the EVENT's `qualifyPerGroup`, and what actually feeds a bracket
     * is the round the field plays before it. See `STAGE_TYPES`.
     *
     * A round robin and a medal round are what a league and a club
     * championship are made of, and neither ends in a draw.
     */
    expect([...KNOCKOUT_STAGE_TYPES].sort()).toEqual(["Bracket Stage"]);
    expect(isKnockoutRound("Bracket Stage")).toBe(true);
    // The removed type must not linger as a knockout by some other route.
    expect(isKnockoutRound("Qualification Stage")).toBe(false);
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
  it("keeps the question in one file, however many types answer it", () => {
    /**
     * Absence, which is the safe direction and comment-proof under
     * `readSource` — the prose above `KNOCKOUT_STAGE_TYPES` names the types and
     * would satisfy a positive assertion happily.
     *
     * WHAT IT GUARDS CHANGED WHEN THE LIST SHRANK. It used to look for a file
     * spelling out the PAIR — "Bracket Stage", "Qualification Stage" — which
     * was the shape of a fifth copy while there were two. The Qualification
     * Stage was removed on 2026-09-11, so that pair can no longer be written
     * and the old check could never fail again: a test that cannot go red is
     * decoration, however true its claim.
     *
     * The live risk with ONE type is a bare `=== "Bracket Stage"` standing in
     * for "is this a knockout", which is how the rule gets forgotten the day a
     * second type comes back. So that is what is banned — except where the
     * branch is genuinely ABOUT the bracket itself rather than about knockouts
     * in general, which is what `ALLOWED` records and why each entry says so.
     */
    /**
     * ALLOWED BY EXPRESSION, NOT BY FILE.
     *
     * The first cut of this exempted whole FILES, and a mutation walked
     * straight through it: putting `some((s) => s.type === "Bracket Stage")`
     * back into an exempted file left the test green. A file-level exemption
     * allows everything in that file for ever — including the exact thing the
     * guard was written to catch, which is the one place it is most likely to
     * reappear.
     *
     * Each entry is the exact line, and each is about THE BRACKET rather than
     * about knockouts as a category.
     */
    const ALLOWED = new Set([
      // Which stage this settings card is for: the play-off for third, and how
      // many players qualify into it. Facts about a bracket.
      `if (stage.type === "Bracket Stage") {`,
      `if (stage.type === "Bracket Stage" && thirdPlace) {`,
      `{stage.type === "Bracket Stage" && thirdPlace && (`,
      `{stage.type === "Bracket Stage" && (`,
      // WHERE the bracket sits, so the stages before it can be sliced off as
      // its feeders. A question about position.
      `const bracketIndex = state.stages.findIndex((s) => s.type === "Bracket Stage");`,
      // One third-place view per bracket.
      `for (const s of state.stages.filter((x) => x.type === "Bracket Stage")) {`,
    ]);
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      if (f.endsWith(join("lib", "stage-types.ts"))) continue;
      for (const line of readSource(f).split("\n")) {
        const t = line.trim();
        if (!/===\s*"Bracket Stage"|"Bracket Stage"\s*===/.test(t)) continue;
        if (!ALLOWED.has(t)) offenders.push(`${f}: ${t}`);
      }
    }
    expect(
      offenders,
      `ask hasKnockoutStage/isKnockoutRound instead of comparing the type: ${offenders.join(", ")}`,
    ).toEqual([]);
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

  it("has the journey card gate the bracket on it", () => {
    /**
     * The card is `TournamentJourney` now — a phased map rather than a flat
     * list — but the rule it has to keep is unchanged: a tournament with no
     * knockout is never walked to a bracket.
     *
     * Pinned as the conditional that builds the "Play" phase's screens, so a
     * mention of `hasBracket` in a prop list cannot satisfy it.
     */
    const card = readSource("src", "components", "TournamentJourney.tsx");
    expect(card).toMatch(/hasBracket \?[\s\S]{0,120}"\/bracket"/);
    // And the un-braced branch has no bracket in it at all.
    const play = card.slice(card.indexOf("hasBracket ?"));
    const branches = play.slice(0, play.indexOf("\n    },"));
    expect(branches.match(/"\/bracket"/g) ?? []).toHaveLength(1);
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
