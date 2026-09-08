import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseResultTranscript, parseHolesTranscript, namesAreDistinct } from "../match";
import { distinctLabels, shortName } from "@/lib/format";
import { stripComments } from "@/lib/__tests__/source";

/**
 * Two players in one match with the same first name.
 *
 * Utterly ordinary in a society — two Daves, two Johns — and every piece of
 * this screen identified a player by their first name alone. Measured, not
 * argued, before any of this was changed:
 *
 *   parseResultTranscript("Dave wins 3 and 2", "Dave", "Dave")  ->  winner "A"
 *   parseHolesTranscript("Dave, half, Dave", "Dave", "Dave", 0, 18)  ->  [A, H, A]
 *
 * The first records the OTHER Dave as having won the match. The second
 * credits A with every hole B won. Neither reports anything: the scorer sees
 * a filled card and a result, and both are wrong. It moves match points,
 * standings and anything settled off them.
 *
 * `match.ts` already carries a comment about exactly this class, from the fix
 * for "Sam" matching inside "Samantha": *between two named people that is not
 * a parsing quirk, it is the wrong result on the board*. This is the case that
 * fix did not cover, and it is the worse one — a prefix collision needs an
 * unlucky pair of names, this needs only two Daves.
 *
 * The rule adopted: a name that cannot identify anybody is not evidence. The
 * parsers decline; the screen widens the label until it can.
 */

describe("a name only counts when it can tell the two apart", () => {
  it("says when two first names are indistinguishable", () => {
    expect(namesAreDistinct("Dave", "Sam")).toBe(true);
    expect(namesAreDistinct("Dave", "dave")).toBe(false);
    expect(namesAreDistinct("Dave", " Dave ")).toBe(false);
    // An empty name identifies nobody either, and used to make `said("")`
    // the guard against a match on everything.
    expect(namesAreDistinct("", "Dave")).toBe(false);
  });
});

describe("dictating the result of a match between two Daves", () => {
  it("does not award it to whichever side was checked first", () => {
    // THE DEFECT. Returned winner "A" — the wrong Dave won the match.
    const r = parseResultTranscript("Dave wins 3 and 2", "Dave", "Dave");
    expect(r.winner, "the name cannot say which Dave, so it must not pick one").toBeNull();
  });

  it("still hears the margin, which is not ambiguous", () => {
    // Refusing the whole utterance would be over-correction: "3 and 2" means
    // the same thing whoever said it, and the scorer only has to say who.
    expect(parseResultTranscript("Dave wins 3 and 2", "Dave", "Dave").margin).toBe("3&2");
    expect(parseResultTranscript("Dave 2 up", "Dave", "Dave").margin).toBe("2 UP");
  });

  it("still halves the match, which needs no name at all", () => {
    expect(parseResultTranscript("all square", "Dave", "Dave")).toEqual({
      winner: "H",
      margin: "AS",
    });
  });

  it("is unchanged when the names DO differ — the control", () => {
    /**
     * Without this, everything above passes just as well against a parser
     * that has stopped recognizing names entirely, which would break voice
     * entry for every ordinary match while looking like a fix.
     */
    expect(parseResultTranscript("Dave wins 3 and 2", "Dave", "Sam")).toEqual({
      winner: "A",
      margin: "3&2",
    });
    expect(parseResultTranscript("Sam 2 up", "Dave", "Sam")).toEqual({
      winner: "B",
      margin: "2 UP",
    });
    // And the earlier prefix fix still holds.
    expect(parseResultTranscript("samantha wins 3 and 2", "Sam", "Samantha").winner).toBe("B");
  });
});

describe("dictating hole by hole between two Daves", () => {
  it("refuses the whole dictation rather than part of it", () => {
    // THE DEFECT. Returned [A, H, A]: three holes recorded, two of them to
    // the wrong player.
    expect(parseHolesTranscript("Dave, half, Dave", "Dave", "Dave", 0, 18)).toEqual([]);
  });

  it("does not fall back to the halves alone, which land on the wrong holes", () => {
    /**
     * The tempting half-measure, stated so it cannot be reintroduced. An
     * unrecognized token does not advance the hole, so dropping only the
     * names from "Dave, half, Dave" yields ["H"] — applied to hole ONE, which
     * the scorer said Dave won. Silently wrong beats loudly refused every
     * time, and this is the loud one.
     */
    expect(parseHolesTranscript("Dave, half, Dave", "Dave", "Dave", 0, 18)).not.toEqual(["H"]);
  });

  it("is unchanged when the names differ — the control", () => {
    expect(parseHolesTranscript("Dave, half, Sam", "Dave", "Sam", 0, 18)).toEqual(["A", "H", "B"]);
  });
});

describe("labelling two names shown side by side", () => {
  it("leaves ordinary names on their first name", () => {
    expect(distinctLabels(["Dave Sherman", "Sam Ito"])).toEqual(["Dave", "Sam"]);
  });

  it("widens only far enough, and only the names that clash", () => {
    // THE DEFECT on screen: the legend read "Dave 0 · Dave 0" and the two
    // colours could not be attached to a person.
    expect(distinctLabels(["Dave Sherman", "Dave Mackay"])).toEqual(["Dave S.", "Dave M."]);
  });

  it("does not widen a third name that never clashed", () => {
    expect(distinctLabels(["Dave Sherman", "Dave Mackay", "Sam Ito"])).toEqual([
      "Dave S.",
      "Dave M.",
      "Sam",
    ]);
  });

  it("falls back to the full name when the initial does not separate them", () => {
    expect(distinctLabels(["Dave Sherman", "Dave Salt"])).toEqual(["Dave Sherman", "Dave Salt"]);
  });

  it("gives up honestly on two identical full names", () => {
    // Nothing short is truthful here, and inventing a disambiguator ("Dave
    // (1)") would attach a number to a person that appears nowhere else.
    expect(distinctLabels(["Dave Sherman", "Dave Sherman"])).toEqual([
      "Dave Sherman",
      "Dave Sherman",
    ]);
  });

  it("keeps the caller's own format when nothing clashes", () => {
    /**
     * The base format is the CALLER'S normal one, not always `firstName`. A
     * screen that writes "First L." wants that on every row, and something
     * wider only where two of them collide.
     *
     * Defaulting it shortened every name on the two screens that use
     * `shortName`, and `render.test.tsx` caught it: a qualification table
     * that had always read "A. J." started reading "A.". Fixing a collision
     * in two rows must not reformat the other thirty-one.
     */
    expect(distinctLabels(["A. Jones", "H. Voss"], shortName)).toEqual(["A. J.", "H. V."]);
  });

  it("still widens past the caller's format when that clashes too", () => {
    expect(distinctLabels(["Dave Sherman", "Dave Salt"], shortName)).toEqual([
      "Dave Sherman",
      "Dave Salt",
    ]);
  });

  it("handles a one-word name beside a clashing full name", () => {
    /**
     * A player added as just "Dave" has no surname to widen into, so it stays
     * "Dave" while the other becomes "Dave M." — which is already distinct,
     * so neither goes to the full name.
     *
     * Written expecting the full-name fallback for both, and that expectation
     * was wrong rather than the code: these two labels tell the players apart
     * and are shorter. Kept as the assertion because "widen only as far as it
     * takes" is the actual rule, and this is the case that pins it.
     */
    expect(distinctLabels(["Dave", "Dave Mackay"])).toEqual(["Dave", "Dave M."]);
  });
});

describe("there is one firstName, and it lives in format.ts", () => {
  /**
   * `HoleByHoleCard` had its own private copy — `n.split(" ")[0]` — and with
   * it the same blind spot, on the screen where one person keeps the card for
   * a whole fourball. Two adjacent rows headed "Dave" is where a score goes
   * onto the wrong card.
   *
   * A second copy is how a rule fixed in one place stays broken in another,
   * which is the reason `brand-consistency.test.ts` exists for the logo. Same
   * shape, same reason.
   */
  const root = process.cwd();

  function allSource(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.name === "__tests__") continue;
      if (e.isDirectory()) allSource(rel, out);
      else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) out.push(rel);
    }
    return out;
  }

  it("defines it exactly once", () => {
    const files = allSource("src");
    expect(files.length, "an empty sweep would pass this vacuously").toBeGreaterThan(100);

    const definers = files.filter((f) =>
      /(?:function|const)\s+firstName\b/.test(stripComments(readFileSync(join(root, f), "utf8"))),
    );
    expect(
      definers,
      "a private copy of firstName is a private copy of its blind spot — import it instead",
    ).toEqual(["src/lib/format.ts"]);
  });
});
