import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { distinctLabels, shortName } from "@/lib/format";
import { stripComments } from "@/lib/__tests__/source";

/**
 * Two players in one match with the same first name.
 *
 * Utterly ordinary in a society — two Daves, two Johns — and every piece of
 * the match screen identified a player by their first name alone: a legend
 * reading "Dave 0 · Dave 0", and two spoken-result readers that gave the
 * OTHER Dave the match. The readers are gone (match play is tapped, not
 * dictated, since 2026-11-09); what is left is the screen's half of the rule —
 * a name that cannot identify anybody is widened until it can.
 */

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
