import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readSource, stripComments } from "./source";

/**
 * "DOES THIS PLAYER NEED STROKES FROM THE COMMITTEE?" IS ASKED IN ONE PLACE (lane N, PR A).
 *
 * The rule — a round scored net, a player with no handicap index, and nothing given or frozen for them —
 * is `needsCommitteeFigure` in `domain/committee-figure.ts`. Before it existed the question had been
 * answered once, inline, by Replace on the tee sheet (`world.net && c.index === NO_INDEX && …`, draft PR
 * #1141), and nowhere else at all: the launch dialog, What's next, the doors and the round's own list
 * said nothing, so a member with no index was scored as a scratch golfer in every net round, unseen.
 *
 * So this sweep refuses the SHAPE of a second copy, not its spelling: a line that asks "has no index"
 * (`handicapSource` compared with "none", `hasIndex(`, a label compared with `NO_INDEX`) within a few lines
 * of one that asks "is this round net" (`isNetBasis(`, `scoringBasis` compared with "gross"). Anywhere in
 * `src` outside the rule's own file. A screen that needs the answer asks the function (or
 * `playersNeedingFigure`, its list).
 *
 * The control below plants one line of each shape and a clean pair, and the sweep must flag exactly the
 * planted ones: a sweep that finds nothing proves nothing until it has been seen to find something.
 */

const ROOT = path.join(process.cwd(), "src");
const RULE_FILE = "src/lib/domain/committee-figure.ts";
/** How close two questions must be to be one rule written out. */
const WINDOW = 6;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(path.relative(process.cwd(), full).split(path.sep).join("/"));
    }
  }
  return out;
}

const NO_INDEX_ASKED = [
  /handicapSource\s*\)?\s*(?:\?\?\s*["'][a-z]+["']\s*\)?\s*)?(?:===|!==|==|!=)\s*["']none["']/,
  /["']none["']\s*(?:===|!==|==|!=)\s*[\w.?]*handicapSource/,
  /\bhasIndex\s*\(/,
  /(?:===|!==)\s*NO_INDEX\b/,
  /\bNO_INDEX\s*(?:===|!==)/,
];
const NET_ASKED = [
  /\bisNetBasis\s*\(/,
  /[sS]coringBasis\s*\)?\s*(?:===|!==|==|!=)\s*["']gross["']/,
  /["']gross["']\s*(?:===|!==|==|!=)\s*[\w.?]*[sS]coringBasis/,
];

/** Each place in `source` where both questions are asked within `WINDOW` lines: the first line, 1-based. */
function secondCopies(source: string): number[] {
  const lines = stripComments(source).split(/\r?\n/);
  const noIndex = lines.map((l) => NO_INDEX_ASKED.some((re) => re.test(l)));
  const net = lines.map((l) => NET_ASKED.some((re) => re.test(l)));
  const hits: number[] = [];
  noIndex.forEach((asked, i) => {
    if (!asked) return;
    for (let j = Math.max(0, i - WINDOW); j <= Math.min(lines.length - 1, i + WINDOW); j++) {
      if (net[j]) {
        hits.push(Math.min(i, j) + 1);
        return;
      }
    }
  });
  return hits;
}

describe("the no-index-in-a-net-round rule is asked in one place", () => {
  it("no file in src asks both questions side by side, except the rule's own", () => {
    const found = walk(ROOT)
      .filter((f) => f !== RULE_FILE)
      .flatMap((f) => secondCopies(readSource(f)).map((line) => `${f}:${line}`));
    expect(found, "ask needsCommitteeFigure (domain/committee-figure.ts) or playersNeedingFigure instead").toEqual([]);
  });

  it("the rule's own file does ask both — so the sweep is reading the right thing", () => {
    expect(secondCopies(readSource(RULE_FILE)).length).toBeGreaterThan(0);
  });

  it("CONTROL: flags each planted shape, and not two questions far apart", () => {
    const planted = [
      // #1141's own line, before it called the rule.
      "if (world.net && c.index === NO_INDEX && world.figures[c.id] === undefined) return x;\nconst y = isNetBasis(stage.scoringBasis);",
      // The source compared by hand, beside a gross test.
      'const bare = p.handicapSource === "none";\nif (stage.scoringBasis !== "gross" && bare) warn();',
      // hasIndex beside isNetBasis.
      "const needs = isNetBasis(r.scoringBasis) && !hasIndex(p);",
    ];
    for (const src of planted) expect(secondCopies(src), src).toHaveLength(1);

    const apart = ["const a = hasIndex(p);", ...Array.from({ length: WINDOW + 2 }, (_, i) => `const filler${i} = ${i};`), "const b = isNetBasis(basis);"].join("\n");
    expect(secondCopies(apart)).toEqual([]);
    // A comment is not code: the sweep reads through `stripComments`.
    expect(secondCopies("// hasIndex(p) && isNetBasis(basis)\nconst z = 1;")).toEqual([]);
  });
});
