import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource, stripComments } from "./source";

/**
 * A KNOCKOUT RESULT HAS ONE DELETE, AND NOTHING CHANGES ONE WITHOUT ASKING
 * (review of #1143: one rule, one place, part 3, the sweep).
 *
 * `laterTieHold` is the rule ("never take a result back from under a later one")
 * and `resultHeldBecause` the one reader of its facts. Both are only as good as
 * the doors that ask them, so this refuses the shape of a door that does not:
 *
 *   1. a `BracketWinner` is DELETED in two places only: `clearTieResult`, the one
 *      taking-back, and `purge` (a whole tournament deleted);
 *   2. one is UPDATED in two places only: `recordBracketWinner`, the one write,
 *      and `setBracketResult`, the margin (which moves nothing on the draw);
 *   3. every action that calls `clearTieResult` or `recordBracketWinner` either
 *      asks `resultHeldBecause` or refuses a tie that already has a result
 *      (`if (m.winnerId)`): it only ever fills an empty tie.
 *
 * Read through `readSource`, comments stripped: prose naming a gate is not one.
 * The control at the foot proves the check sees a door that does not ask.
 */

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(name)) out.push(path.replace(/\\/g, "/"));
  }
  return out;
}

const ALL = sourceFiles("src").map((path) => ({ path, src: readSource(path) }));

function filesWith(pattern: RegExp): string[] {
  return ALL.filter((f) => pattern.test(f.src)).map((f) => f.path).sort();
}

/** Each top-level function of a source, by name: from its declaration to the next one. */
function functionsOf(src: string): { name: string; body: string }[] {
  const starts = [...src.matchAll(/^(?:export )?async function (\w+)/gm)];
  return starts.map((m, i) => ({ name: m[1], body: src.slice(m.index!, starts[i + 1]?.index ?? src.length) }));
}

/** The functions that write a knockout result without asking the rule or refusing a decided tie. */
function doorsThatDoNotAsk(src: string): string[] {
  return functionsOf(src)
    .filter((f) => f.name !== "recordBracketWinner" && /\b(clearTieResult|recordBracketWinner)\(/.test(f.body))
    .filter((f) => !/\bresultHeldBecause\(/.test(f.body) && !/if \(m\.winnerId\)/.test(f.body))
    .map((f) => f.name);
}

describe("a knockout result has one delete, and nothing changes one without asking", () => {
  it("is deleted only by clearTieResult and by purging a whole tournament", () => {
    expect(filesWith(/bracketWinner\.delete(Many)?\(/)).toEqual(["src/lib/services/knockout-result.ts", "src/lib/services/purge.ts"]);
  });

  it("is updated only by the one write and the margin", () => {
    expect(filesWith(/bracketWinner\.(update|updateMany|upsert)\(/)).toEqual(["src/app/actions/tournament.ts"]);
    const writers = functionsOf(readSource("src/app/actions/tournament.ts"))
      .filter((f) => /bracketWinner\.(update|updateMany|upsert)\(/.test(f.body))
      .map((f) => f.name);
    expect(writers).toEqual(["recordBracketWinner", "setBracketResult"]);
  });

  it("every action that records or takes back a result asks the rule, or fills only an empty tie", () => {
    const callers: string[] = [];
    for (const file of readdirSync("src/app/actions").filter((f) => f.endsWith(".ts"))) {
      const src = readSource("src/app/actions", file);
      callers.push(...functionsOf(src).filter((f) => /\b(clearTieResult|recordBracketWinner)\(/.test(f.body) && f.name !== "recordBracketWinner").map((f) => `${file}:${f.name}`));
      expect(doorsThatDoNotAsk(src), `${file}: these write a knockout result without asking resultHeldBecause`).toEqual([]);
    }
    // The doors as they are, so a new one is read here before it is trusted.
    expect(callers.sort()).toEqual([
      "knockout-results.ts:undoTieResult",
      "tournament.ts:approveBracketReport",
      "tournament.ts:recordTieResult",
      "tournament.ts:setBracketWinner",
    ]);
  });

  it("CONTROL: the check sees a door that does not ask, and passes one that does", () => {
    const bad = stripComments(`
      export async function sneaky(key: string) {
        // resultHeldBecause( is only named here, in a comment
        await clearTieResult("e", key);
      }
      export async function honest(key: string) {
        const held = resultHeldBecause(state, key);
        if (held) return;
        await clearTieResult("e", key);
      }
      export async function fillsOnlyEmpty(key: string) {
        if (m.winnerId) return;
        await recordBracketWinner("e", key, "w");
      }
    `).replace(/^[ \t]+/gm, ""); // declared at the margin, as a source file declares them
    expect(doorsThatDoNotAsk(bad)).toEqual(["sneaky"]);
  });
});
