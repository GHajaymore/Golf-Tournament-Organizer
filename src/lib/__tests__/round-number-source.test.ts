import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { readSource, stripComments } from "./source";

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
 * THE SAME COUNT IN JSX, which the pattern above cannot see (2026-10-16).
 *
 * Rounds & formats wrote `Round {stage.position + 1}` in its own heading, and a
 * badge beside it holding `{stage.position + 1}` alone. Positions are not closed
 * up when a round is removed, so after deleting Round 1 the list read "Round 2,
 * Round 3, Round 4" under a banner on the same screen calling them Rounds 1 and
 * 2 — and this guard, which bans the template-string spelling, was green over
 * both. Ban the shape, not the spelling: a position or an index plus one, put
 * on the screen in braces.
 */
const JSX_COUNTED = /Round \{[^}]*\b(?:position|index|i|idx|n)\b[^}]*\+\s*1\s*\}|>\s*\{\s*[\w.]*\bposition\s*\+\s*1\s*\}\s*</;
const HAND_COUNTED_ALL = new RegExp(`${HAND_COUNTED.source}|${JSX_COUNTED.source}`, "g");

/**
 * Where a hand-built round number is still correct, each for a stated reason.
 *
 * Short by design. Anything added here needs the reason written next to it,
 * because every entry is a place the app can drift apart again.
 *
 * BY COUNT, NOT BY FILE. This used to exempt a whole file, and
 * `app/actions/tournament.ts` is five thousand lines: two audit-log labels
 * ("Closed Round 2", "Completing the tournament closed Round 2") were written
 * inside it with exactly the banned count and nothing noticed, because the
 * file's one legitimate key made every other use in it invisible. So each file
 * may hold as many as its stated keys and no more — a new one fails here.
 */
const ALLOWED: Record<string, { count: number; reason: string }> = {
  /**
   * NOT A LABEL — a database lookup key.
   *
   * `matchCarrierGroup` finds-or-creates a Group BY NAME, so this string is how
   * an existing flight is found again. Renumbering it would not correct old
   * tournaments; it would create a second flight beside the first and split a
   * club's matches across the two. Changing it needs a migration, not an edit.
   */
  "app/actions/teams.ts": { count: 1, reason: "Group name used as a find-or-create key" },
  // Two keys: the round's own match carrier and the play-off for third.
  "app/actions/tournament.ts": { count: 2, reason: "Group name used as a find-or-create key" },
  // The league week draw hands `matchCarrierGroup` the same name
  // `generateTeamMatches` uses, so a week drawn either way finds one carrier.
  "app/actions/league.ts": { count: 1, reason: "Group name used as a find-or-create key" },
};

describe("round numbers come from one place", () => {
  const offenders = sourceFiles(SRC)
    .map((f) => ({
      file: relative(SRC, f).split(sep).join("/"),
      // Stripped, or a comment quoting the banned `Round ${i + 1}` shape to
      // explain the rule would be reported as a violation of it.
      src: stripComments(readFileSync(f, "utf8")),
    }))
    .map(({ file, src }) => ({ file, found: (src.match(HAND_COUNTED_ALL) ?? []).length }))
    .filter(({ file, found }) => found > (ALLOWED[file]?.count ?? 0))
    .map(({ file, found }) => `${file} (${found} hand-counted, ${ALLOWED[file]?.count ?? 0} allowed)`);

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
      const src = readSource("src", file);
      const looksItUp = /matchCarrierGroup\(/.test(src) || /group\.findFirst\(\{\s*where:\s*\{[^}]*name/.test(src);
      expect(looksItUp, `${file}: ${ALLOWED[file].reason}`).toBe(true);
    }
  });

  it("CONTROL: it sees a count written in JSX, the two lines it once missed", () => {
    const missed = [
      "<span>\n              Round {stage.position + 1}\n            </span>",
      '<div title={stage.type}>\n          {stage.position + 1}\n        </div>',
    ];
    for (const line of missed) expect(line.match(HAND_COUNTED_ALL), line).not.toBeNull();
    // …and not an honest number handed in, or a date.
    expect("Round {n}".match(HAND_COUNTED_ALL)).toBeNull();
    expect("{roundNumber(allStages, stage.id)}".match(HAND_COUNTED_ALL)).toBeNull();
  });

  it("the helper is the one place that formats the words", () => {
    const helper = readSource("src", "lib", "domain", "round-label.ts");
    expect(helper).toMatch(/`Round \$\{n\}`/);
  });
});
