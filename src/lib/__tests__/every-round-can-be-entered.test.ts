import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * A ROUND THAT IS CREATED IS A ROUND THAT CAN BE ENTERED.
 *
 * A Round Code is how a player without an account reaches their card. A round
 * with a blank one cannot be entered by anybody holding a code, and nothing
 * says so: the organizer's Round Codes list has a gap where the code would be,
 * which reads as "not generated yet" rather than as a door that does not open.
 *
 * The rule was enforced in exactly one place — `saveTournamentSettings`, on the
 * TRANSITION from not-using-codes to using-codes — which is a guard you must
 * remember to be standing in front of. The four places that create a round
 * were not standing in front of it, and neither was a tournament created with
 * codes already on, because that has no transition at all.
 *
 * Measured against the development database on 2026-09-14: all three
 * code-using tournaments were affected. One had a single round of four coded;
 * the other two had ZERO of theirs — code entry switched on, and never once
 * having worked.
 *
 * So `ensureRoundCodes` is a sink: idempotent, reads the setting itself, fills
 * blanks and nothing else. This sweep is what keeps every creation path
 * pointed at it, because the next one will be written by somebody who has
 * never read this file.
 */

const ACTIONS = join("src", "app", "actions");

function actionFiles(): string[] {
  return readdirSync(ACTIONS)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(ACTIONS, f));
}

/** Files that bring a Stage row into existence. */
function creators(): Array<{ file: string; src: string; sites: number }> {
  const out: Array<{ file: string; src: string; sites: number }> = [];
  for (const file of actionFiles()) {
    const src = readSource(file);
    const sites =
      src.split("prisma.stage.create(").length -
      1 +
      (src.split("prisma.stage.createMany(").length - 1);
    if (sites > 0) out.push({ file: file.replace(/\\/g, "/"), src, sites });
  }
  return out;
}

const made = creators();

describe("every round a creation path makes can be entered with a code", () => {
  it("finds the paths that create rounds — the sweep's own control", () => {
    /**
     * Four on 2026-09-14, across three files. Naming the count rather than the
     * files so that adding a fifth path is caught by the assertion below
     * rather than by this one — but a sweep that suddenly finds NONE is an
     * instrument that has stopped working, and that is what this catches.
     */
    expect(
      made.map((m) => m.file),
      "nothing in src/app/actions creates a Stage — the sweep is broken",
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("tournament.ts"),
        expect.stringContaining("setup-suggest.ts"),
        expect.stringContaining("match-setup.ts"),
      ]),
    );
  });

  it.each(made.map((m) => m.file))("%s issues a code for what it creates", (file) => {
    const { src } = made.find((m) => m.file === file)!;

    /**
     * Two acceptable answers, and they are not interchangeable.
     *
     * `ensureRoundCodes` is the ordinary one: it reads the tournament's access
     * setting and fills every blank, which is what a path creating rounds for
     * an existing tournament needs.
     *
     * `accessCode:` written into the `create` is the other, and `match-setup`
     * uses it for a reason its own comment gives: a casual round sets
     * `playerAccess: "both"` in the same call, so there is no saved setting to
     * read back yet — the code and the setting are one write.
     */
    const viaSink = src.includes("ensureRoundCodes(");
    const viaInlineCode = src.includes("accessCode:");
    expect(
      viaSink || viaInlineCode,
      `this file creates a Stage and never issues it a code. A round of a ` +
        `code-using tournament with a blank accessCode cannot be entered by ` +
        `anyone holding a code. Call ensureRoundCodes(eventId) after creating.`,
    ).toBe(true);
  });
});

/**
 * AND THE SINK IS STILL A SINK.
 *
 * The value of `ensureRoundCodes` is that a caller does not have to know the
 * rule — it reads `playerAccess` itself and refuses to issue for a tournament
 * that is not using codes. A version that trusted its caller would put that
 * decision back into four places, which is where it came from.
 */
describe("ensureRoundCodes decides for itself whether codes apply", () => {
  const src = readSource("src", "lib", "services", "round-codes.ts");

  it("reads the tournament's own access setting", () => {
    expect(src, "it no longer asks whether this tournament uses codes").toContain(
      "usesAccessCodes(",
    );
  });

  it("only ever fills a blank", () => {
    /**
     * The half that makes it safe to call anywhere. It selects the stages
     * whose code is empty; a version selecting all of them would reissue live
     * codes on every save and sign out a field mid-round.
     */
    expect(src, "it is no longer scoped to stages with no code").toContain('accessCode: ""');
  });
});
