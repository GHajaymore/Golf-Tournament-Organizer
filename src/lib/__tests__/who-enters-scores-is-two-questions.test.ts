import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./source";

/**
 * "WHO ENTERS SCORES" NAMED TWO SETTINGS, SO IT NAMES NEITHER (R4b-1, 22 Nov 2026).
 *
 * The event's `scoreEntryBy` is "Can players enter scores?"; the round's `scoreKeeping` is "Who keeps
 * the card". One phrase over both made an organizer change one believing it changed the other. The
 * phrase must not come back on any screen, notice or guide text under `src/` (comments stripped; tests
 * excluded, since they may quote the old words to say what changed).
 */
const PHRASE = /who enters scores/i;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return e === "__tests__" ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(e) ? [p] : [];
  });

const holders = (files: Array<[string, string]>) => files.filter(([, t]) => PHRASE.test(stripComments(t))).map(([n]) => n);

describe("the old phrase is gone", () => {
  it("is found in no source file under src/", () => {
    const root = join(process.cwd(), "src");
    const all = sourceFiles(root).map((p): [string, string] => [p.slice(root.length + 1).split("\\").join("/"), readFileSync(p, "utf8")]);
    expect(all.length).toBeGreaterThan(100);
    expect(holders(all)).toEqual([]);
  });

  it("control: a planted file is caught, in any case", () => {
    expect(holders([["planted.ts", `const x = "Who enters scores";`]])).toEqual(["planted.ts"]);
    expect(holders([["planted.ts", `const x = "who enters scores?";`]])).toEqual(["planted.ts"]);
    expect(holders([["comment.ts", `// who enters scores\nconst x = 1;`]])).toEqual([]);
  });
});
