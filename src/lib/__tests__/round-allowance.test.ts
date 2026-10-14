import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";
import { FORMAT_NAMES, findFormat } from "../formats";
import { STAGE_TYPES, isHeadToHead } from "../stage-types";
import { effectiveAllowance, recommendedAllowance } from "../round-allowance";

/**
 * A FOUR-BALL IS 85% AT STROKE PLAY AND 90% IN A MATCH.
 *
 * Rules of Handicapping, Appendix C — the table of recommended allowances:
 *
 *     Four-ball stroke play   85%
 *     Four-ball match play    90%
 *
 * The app holds one figure per format and for Four-Ball held the second, so a
 * four-ball medal was offered 90% as "the recommended allowance for this
 * format". Found 2026-10-13 while writing a test that works each board out from
 * the Rules; the seeded club's own four-ball round already carried 85% "set by
 * your committee, in place of the usual 90%", typed over the app's figure by
 * whoever wrote the fixture.
 *
 * The allowance is therefore asked of the ROUND: `recommendedAllowance(format,
 * stageType)`. The round's type is a required argument, so a caller cannot ask
 * the format alone — that is the half this file reads the source for.
 *
 * WHAT IT DOES NOT COVER: Appendix C also gives best 1 of 4 at 75% and best 3
 * of 4 at 100%, which the app's Best Ball does not follow (it plays 85%
 * whatever the side). That is written down in `docs/deferred-register.md`.
 */

const TYPES: string[] = [...STAGE_TYPES];
const MATCHES = TYPES.filter((t) => isHeadToHead(t));
const MEDALS = TYPES.filter((t) => !isHeadToHead(t));

describe("what a four-ball plays at", () => {
  it("CONTROL: there are rounds of both kinds to ask about", () => {
    expect(MATCHES.length).toBeGreaterThan(0);
    expect(MEDALS).toContain("Stroke Play Round");
    expect(findFormat("Four-Ball").name).toBe("Four-Ball");
  });

  it("85% on a stroke-play round", () => {
    expect(recommendedAllowance("Four-Ball", "Stroke Play Round")).toBe(85);
    for (const type of MEDALS) expect(recommendedAllowance("Four-Ball", type), type).toBe(85);
  });

  it("90% on every round that is a match", () => {
    for (const type of MATCHES) expect(recommendedAllowance("Four-Ball", type), type).toBe(90);
  });

  it("the committee's own figure, whatever the round", () => {
    for (const type of TYPES) {
      expect(effectiveAllowance("Four-Ball", 100, type), type).toBe(100);
      expect(effectiveAllowance("Four-Ball", 90, type), type).toBe(90);
      // Nought stored is "nothing said", never 0%.
      expect(effectiveAllowance("Four-Ball", 0, type), type).toBe(recommendedAllowance("Four-Ball", type));
    }
  });

  it("a round of a kind nobody has taught the app is not a match", () => {
    // `isHeadToHead` is false for an unknown type, and so is this: a stroke round's figure.
    expect(recommendedAllowance("Four-Ball", "A Kind Of Round That Does Not Exist")).toBe(85);
    expect(recommendedAllowance("Four-Ball", null)).toBe(85);
    expect(recommendedAllowance("Four-Ball", undefined)).toBe(85);
  });
});

describe("every other format keeps the one figure it has", () => {
  it("the same on a stroke-play round and in a match", () => {
    for (const format of FORMAT_NAMES) {
      if (format === "Four-Ball") continue;
      for (const type of TYPES) {
        expect(recommendedAllowance(format, type), `${format} on a ${type}`).toBe(findFormat(format).allowance);
      }
    }
  });

  it("and those figures are Appendix C's where it gives one", () => {
    expect(findFormat("Stroke Play").allowance).toBe(95);
    expect(findFormat("Stableford").allowance).toBe(95);
    expect(findFormat("Match Play").allowance).toBe(100);
    expect(findFormat("Foursomes").allowance).toBe(50);
    // Greensomes and Chapman are 60% of the lower handicap and 40% of the higher.
    expect(findFormat("Greensomes").weightsBySideSize?.[2]).toEqual([60, 40]);
    expect(findFormat("Chapman / Pinehurst").weightsBySideSize?.[2]).toEqual([60, 40]);
    // A scramble of four is 25/20/15/10 and of two 35/15, lowest handicap first.
    expect(findFormat("Scramble").weightsBySideSize?.[4]).toEqual([25, 20, 15, 10]);
    expect(findFormat("Scramble").weightsBySideSize?.[2]).toEqual([35, 15]);
  });
});

/**
 * NOBODY ASKS THE FORMAT ALONE WHAT A ROUND PLAYS AT.
 *
 * `effectiveAllowance` takes the round's type and will not compile without it.
 * The other way round the rule is to read the format's own figure directly —
 * `findFormat(x).allowance` — which is right in exactly two places: the rule
 * itself, and a shared-ball side's handicap, which is 50% of the pair or a set
 * of shares in a match and at stroke play alike.
 */
describe("the round is asked, not the format", () => {
  function sources(dir = "src", out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "__tests__" || e.name === "node_modules") continue;
        sources(rel, out);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
    }
    return out;
  }
  /** A format's own allowance, read off the format: `f.allowance`, `format.allowance`, `findFormat(x).allowance`. */
  const OFF_THE_FORMAT = /(?:\bf|\bformat|findFormat\([^)]*\))\.allowance\b/;
  const MAY: Record<string, string> = {
    "src/lib/round-allowance.ts": "the rule itself",
    "src/lib/services/teams.ts": "a shared-ball side: 50% of the pair, the same in a match and at stroke play",
    "src/components/TeamsClient.tsx": "its `format` is the ROUND's view, handed down by the Teams page with the round's own allowance in it",
  };

  it("CONTROL: the three spellings are recognised, and the rule's own file is one of them", () => {
    expect(OFF_THE_FORMAT.test("return override > 0 ? override : findFormat(format).allowance;")).toBe(true);
    expect(OFF_THE_FORMAT.test("recommendedAllowance: f.allowance,")).toBe(true);
    expect(OFF_THE_FORMAT.test("recommendedAllowance: format.allowance,")).toBe(true);
    expect(OFF_THE_FORMAT.test("allowance: effectiveAllowance(s.format, s.handicapAllowance, s.type),")).toBe(false);
    expect(OFF_THE_FORMAT.test(readSource("src/lib/round-allowance.ts"))).toBe(true);
    expect(sources().length).toBeGreaterThan(400);
  });

  it("no screen, action or service reads a format's allowance off the format", () => {
    const offenders = sources().filter((f) => !(f in MAY) && OFF_THE_FORMAT.test(readSource(f)));
    expect(offenders, "ask recommendedAllowance(format, stage.type), or effectiveAllowance with the round's own figure").toEqual([]);
  });

  it("the two screens that say what is recommended ask the round", () => {
    for (const file of ["src/app/(app)/stages/page.tsx", "src/app/(app)/teams/page.tsx"]) {
      expect(readSource(file), file).toMatch(/recommendedAllowance: recommendedAllowance\(\w+\.format, \w+\.type\)/);
    }
  });
});
