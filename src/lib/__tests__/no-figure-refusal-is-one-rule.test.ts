import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { readSource } from "./source";

/**
 * "NOBODY WITHOUT A FIGURE ENTERS A NET ROUND" HAS ONE GATE (J39/J40 PR 3B, PE review of 20 Nov).
 *
 * `figureRefusal(scoringBases, name, hasFigure)` in `domain/committee-figure.ts` is the gate for Replace's guest
 * branch and for approving a self-entered guest. A second copy was written once (`approvalFigureRefusal` over
 * `anyRoundNet`); this sweep refuses another:
 *   1. the sentence "the committee gives" is code in `figureRefusal` and in the hint beside Replace's box and the guide's prose only;
 *   2. nobody asks `.some(... isNetBasis ...)` ("is any round net") outside that gate.
 * The control plants each shape and a clean line; a sweep that finds nothing proves nothing until it finds something.
 */

const GATE = "src/lib/domain/committee-figure.ts";
const SENTENCE_OK = new Set([GATE, "src/components/ReplacePlayer.tsx", "src/lib/guide-steps.ts"]);
const SENTENCE = /handicap the committee gives/;
const ANY_NET = /\.some\([^\n]*isNetBasis|isNetBasis[^\n]*\.some\(|function anyRoundNet|anyRoundNet\s*\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__") walk(full, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(relative(process.cwd(), full).split(sep).join("/"));
  }
  return out;
}

/** Files that hold a second copy, given each file's comment-free source. */
export function secondCopies(files: Record<string, string>): string[] {
  const bad: string[] = [];
  for (const [f, src] of Object.entries(files)) {
    if (!SENTENCE_OK.has(f) && SENTENCE.test(src)) bad.push(`${f}: the figure sentence`);
    if (f !== GATE && ANY_NET.test(src)) bad.push(`${f}: asks "is any round net" itself`);
  }
  return bad;
}

describe("the no-figure refusal has one gate", () => {
  it("control: a planted copy of each shape is flagged and a clean file is not", () => {
    expect(
      secondCopies({
        "src/x/a.ts": "return `Type the handicap the committee gives ${n} first`;",
        "src/x/b.ts": "const net = stages.some((s) => isNetBasis(s.scoringBasis));",
        "src/x/c.ts": "const ok = stages.length > 0;",
      }),
    ).toEqual(["src/x/a.ts: the figure sentence", 'src/x/b.ts: asks "is any round net" itself']);
  });

  it("no second copy exists in src", () => {
    const files: Record<string, string> = {};
    for (const f of walk(join(process.cwd(), "src"))) files[f] = readSource(f);
    expect(secondCopies(files)).toEqual([]);
  });
});
