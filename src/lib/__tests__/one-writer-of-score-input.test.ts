import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * ONE WRITER OF `Stage.scoreInput` (R4, the move). Two controls used to write it: the round card's radio list and
 * the team round's select in `RoundTeamScoring`. Both now go through `writeScoreInput` in `RoundScoreInput.tsx`,
 * the only file in `src/` (tests and the action's own definition apart) that calls `setStageScoreInput`.
 */

const THE_WRITER = "src/components/rounds/RoundScoreInput.tsx";

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p.split("\\").join("/"));
  }
  return out;
}

/** The files that call or import `setStageScoreInput`, given a way to read each. */
export function writersOfScoreInput(all: string[], read: (f: string) => string): string[] {
  return all.filter((f) => !f.endsWith("src/app/actions/tournament.ts") && /\bsetStageScoreInput\b/.test(read(f))).sort();
}

describe("one writer of Stage.scoreInput", () => {
  const all = files("src");
  it("only RoundScoreInput.tsx calls setStageScoreInput", () => {
    expect(writersOfScoreInput(all, (f) => readSource(f))).toEqual([THE_WRITER]);
  });

  it("both of the controls reach it through writeScoreInput", () => {
    expect(readSource("src/components/RoundTeamScoring.tsx")).toMatch(/await writeScoreInput\(/);
    expect(readSource("src/components/rounds/use-round-ctx.tsx")).toMatch(/await writeScoreInput\(/);
  });

  it("CONTROL: a planted second writer is caught, and the sweep reads the real tree", () => {
    const planted = "src/components/ZzSecondWriter.tsx";
    const read = (f: string) => (f === planted ? `import { setStageScoreInput } from "@/app/actions/tournament"; setStageScoreInput("x", "y");` : readSource(f));
    expect(writersOfScoreInput([...all, planted], read)).toEqual([planted, THE_WRITER].sort());
    expect(all.length).toBeGreaterThan(500);
  });
});
