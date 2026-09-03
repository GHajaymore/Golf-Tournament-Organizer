import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Nobody counts rounds by hand any more.
 *
 * A guard that reads the source, because the failure is invisible at runtime:
 * every screen was internally consistent, and no screen showed two counts at
 * once. `stage.position + 1` counts the cut as a round; an index into a
 * filtered list does not; an index into `rrStages` counts only the round
 * robins. All three were in use, and a club championship with a cut in it was
 * told "Round 3" on the Stages and Teams screens and "Round 2" on prizes,
 * group games, score entry and the player's own dashboard.
 *
 * `roundLabel` settles it. This stops a twentieth copy appearing, which is the
 * only way a rule with this many readers stays true — CLAUDE.md's "a guard you
 * must remember to call is a guard that will be forgotten".
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * A round NUMBER built by hand: "Round " immediately followed by an
 * interpolation that is arithmetic on an index or a position.
 *
 * Deliberately narrow. "Round ${fromRound}" where the number arrived as an
 * argument is not this bug — the caller decided it — and neither is a date or
 * a number a person typed. What this catches is the act of DERIVING the number
 * from a list position at the point of display.
 */
const HAND_COUNTED = /Round \$\{[^}]*\b(?:position|index|i|idx|n)\b[^}]*\+\s*1/;

/**
 * Where a hand-built round number is still correct, each for a stated reason.
 *
 * Short by design. Anything added here needs the reason written next to it,
 * because every entry is a place the app can drift apart again.
 */
const ALLOWED: Record<string, string> = {
  /**
   * NOT A LABEL — a database lookup key.
   *
   * `matchCarrierGroup` finds-or-creates a Group BY NAME, so this string is how
   * an existing flight is found again. Renumbering it would not correct old
   * tournaments; it would create a second flight beside the first and split a
   * club's matches across the two. Changing it needs a migration, not an edit.
   */
  "app/actions/teams.ts": "Group name used as a find-or-create key",
  "app/actions/tournament.ts": "Group name used as a find-or-create key",
};

describe("round numbers come from one place", () => {
  const offenders = sourceFiles(SRC)
    .map((f) => ({ file: relative(SRC, f).split(sep).join("/"), src: readFileSync(f, "utf8") }))
    .filter(({ src }) => HAND_COUNTED.test(src))
    .map(({ file }) => file)
    .filter((f) => !(f in ALLOWED));

  it("no screen derives a round number from a list position", () => {
    // The message names the file, because the fix is always the same: call
    // `roundLabel(stages, id)` and pass it the whole stage list.
    expect(offenders, offenders.join(", ")).toEqual([]);
  });

  it("the exemptions still look the name up rather than merely printing it", () => {
    /**
     * An allowlist nobody re-reads becomes a place to hide things. The stated
     * reason is that the string is a find-or-create KEY, so the file has to
     * contain the lookup — `matchCarrierGroup`, or the same query written out,
     * which `teams.ts` does inline. If that goes, so does the exemption.
     */
    for (const file of Object.keys(ALLOWED)) {
      const src = readFileSync(join(SRC, file), "utf8");
      const looksItUp = /matchCarrierGroup\(/.test(src) || /group\.findFirst\(\{\s*where:\s*\{[^}]*name/.test(src);
      expect(looksItUp, `${file}: ${ALLOWED[file]}`).toBe(true);
    }
  });

  it("the helper is the one place that formats the words", () => {
    const helper = readFileSync(join(SRC, "lib", "domain", "round-label.ts"), "utf8");
    expect(helper).toMatch(/`Round \$\{n\}`/);
  });
});
