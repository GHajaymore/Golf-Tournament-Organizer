import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readSource } from "./source";

/**
 * A STROKE TABLE ACROSS ROUNDS IS THE BOARD'S, AND NOBODY ADDS UP CARDS FOR ONE.
 *
 * Who holds a place after round N of a stroke competition — the cut, a closed
 * round with no card on it, a card stopped short, the countback — is decided
 * once, by the board (`loadEventState`), and `standingsThroughRound` is how any
 * other screen asks it for the table after a round.
 *
 * The league week sheet used to sum each player's cards itself and rank the
 * totals, so in the seeded Club Championship the twelve who missed the cut led
 * "standings after round 2" on one round's gross (2026-10-21). Every function
 * in it was right on its own; the fault was a second answer to one question.
 * `week-table-holds-only-a-place.audit.test.ts` pins the ANSWER from the Rules;
 * this refuses a second copy of the QUESTION.
 *
 * So every call of `aggregateStroke` outside the board is listed here with the
 * ONE round it sums. A new caller fails until somebody says which round, and a
 * caller that sums several rounds is the thing this file exists to stop: it
 * should be asking `standingsThroughRound`.
 *
 * SWEPT FROM THE FILESYSTEM, so a file added tomorrow is swept tomorrow.
 */

const ROOT = path.join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      walk(full, out);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(path.relative(process.cwd(), full).split(path.sep).join("/"));
    }
  }
  return out;
}

/** Files that call the card summer, and how many times. */
function callers(read: (file: string) => string, files: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of files) {
    const n = read(f).split("aggregateStroke(").length - 1;
    if (n > 0) out.set(f, n);
  }
  return out;
}

/**
 * Each caller, the number of calls, and the round each one sums.
 *
 * `domain/stroke-agg.ts` is where it is defined. The board sums every round it
 * ranks, which is its job. The other two sum ONE round's cards each.
 */
const ALLOWED: Record<string, { calls: number; why: string }> = {
  "src/lib/domain/stroke-agg.ts": { calls: 1, why: "the definition" },
  "src/lib/services/tournament.ts": { calls: 1, why: "the board — every round it ranks" },
  "src/lib/services/week-view.ts": { calls: 1, why: "the night's own table: this week's cards only" },
  "src/lib/services/tournament-result.ts": { calls: 1, why: "one round's result, that round's cards only" },
};

describe("a stroke table across rounds", () => {
  const found = callers((f) => readSource(f), walk(ROOT));

  it("the sweep sees a call where one is (the control)", () => {
    // If this fails the sweep is reading nothing and the test below is empty.
    expect(found.get("src/lib/services/tournament.ts")).toBe(1);
    // And it would see a second copy: the week sheet as it stood before the
    // fix summed cards twice — the night, and the season table.
    const before = "aggregateStroke(thisWeek, opts); const through = () => aggregateStroke(parseStrokeCards(cards), opts);";
    expect(callers(() => before, ["week-view.ts"]).get("week-view.ts")).toBe(2);
  });

  it("is summed from cards nowhere but the board", () => {
    const unexpected = [...found].filter(([f, n]) => ALLOWED[f]?.calls !== n).map(([f, n]) => `${f} (${n})`);
    expect(unexpected, "a new reader that sums cards — if it spans rounds, ask standingsThroughRound").toEqual([]);
  });

  it("and the week sheet's one sum is the night's", () => {
    const src = readSource("src/lib/services/week-view.ts");
    expect(src).toContain("aggregateStroke(thisWeek,");
    expect(src).toMatch(/const thisWeek = [^;]*cards\.filter\(\(c\) => c\.stageId === stage\.id\)/);
    // The season table asks the board.
    const season = src.slice(src.indexOf("async function standingsWithMovement"));
    expect(season.length, "standingsWithMovement was not found").toBeGreaterThan(100);
    expect(season).toContain("standingsThroughRound(");
    expect(season).not.toContain("parseStrokeCards(");
  });
});
