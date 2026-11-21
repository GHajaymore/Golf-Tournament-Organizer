import { describe, it, expect } from "vitest";
import { GUIDE_STEPS, type GuideSection } from "../guide-steps";
import { REDESIGN_GUIDE, guideFor, type GuideVariant } from "../guide/redesign";
import { SCREEN_KEYS, type ScreenKey } from "../domain/console-merges";
import { guideShapeProblems } from "./guide-word-checks";
import { readSource } from "./source";

/**
 * THE GUIDE'S REDESIGN HARNESS (R1b): with no variant the guide is exactly today's, for every set of
 * shown screens; a variant swaps in only the sections it names, only while its screen is shown.
 */

const section = (id: string, text: string): GuideSection => ({ id, part: "Part", title: id, blocks: [{ kind: "p", text }] });
const BASE = [section("alpha", "one"), section("beta", "two"), section("gamma", "three"), section("delta", "four")];
const SCREEN: ScreenKey = SCREEN_KEYS[0];
const OTHER: ScreenKey = SCREEN_KEYS[1];
const variant = (over: Partial<GuideVariant> = {}): GuideVariant => ({
  screen: SCREEN,
  replaces: ["beta", "gamma"],
  sections: [section("newbeta", "replaced")],
  ...over,
});

describe("the guide with the redesign's registry", () => {
  it("starts empty, so the guide is IDENTICAL to GUIDE_STEPS for every set of shown screens", () => {
    expect(REDESIGN_GUIDE).toEqual([]);
    const sets: ScreenKey[][] = [[], [...SCREEN_KEYS], ...SCREEN_KEYS.map((k) => [k])];
    for (const shown of sets) expect(guideFor(GUIDE_STEPS, shown)).toEqual(GUIDE_STEPS);
    expect(guideFor(GUIDE_STEPS, [...SCREEN_KEYS])).toBe(GUIDE_STEPS);
  });

  it("a planted variant replaces exactly the sections it names, in place, while its screen is shown", () => {
    const out = guideFor(BASE, [SCREEN], [variant()]);
    expect(out.map((s) => s.id)).toEqual(["alpha", "newbeta", "delta"]);
  });

  it("…and is not drawn while its screen is not shown", () => {
    expect(guideFor(BASE, [], [variant()])).toEqual(BASE);
    expect(guideFor(BASE, [OTHER], [variant()])).toEqual(BASE);
  });

  it("a variant that replaces nothing is added after the last section", () => {
    const out = guideFor(BASE, [SCREEN], [variant({ replaces: [] })]);
    expect(out.map((s) => s.id)).toEqual(["alpha", "beta", "gamma", "delta", "newbeta"]);
  });

  it("two shown screens each swap their own", () => {
    const second = variant({ screen: OTHER, replaces: ["alpha"], sections: [section("newalpha", "x")] });
    const out = guideFor(BASE, [SCREEN, OTHER], [variant(), second]);
    expect(out.map((s) => s.id)).toEqual(["newalpha", "newbeta", "delta"]);
  });

  it("does not change the base it was handed", () => {
    const before = BASE.map((s) => s.id);
    guideFor(BASE, [SCREEN], [variant()]);
    expect(BASE.map((s) => s.id)).toEqual(before);
  });

  it("CONTROL: the sweep of a registry sees a variant that is wrong", () => {
    expect(guideShapeProblems([section("Bad Id", "x")])).not.toEqual([]);
    expect(guideShapeProblems([{ ...section("empty", "x"), blocks: [] }])).not.toEqual([]);
    expect(guideShapeProblems([section("same", "a"), section("same", "b")])).not.toEqual([]);
  });
});

describe("every registered variant (none yet)", () => {
  const ids = new Set(GUIDE_STEPS.map((s) => s.id));
  it("replaces ids that exist, and none is replaced by two screens", () => {
    const claimed = new Map<string, ScreenKey>();
    for (const v of REDESIGN_GUIDE) {
      for (const id of v.replaces) {
        expect(ids.has(id), `${v.screen} replaces "${id}", which is not a guide section`).toBe(true);
        expect(claimed.get(id), `"${id}" is replaced by two screens`).toBeUndefined();
        claimed.set(id, v.screen);
      }
    }
  });

  it("holds its sections to the same word checks as the guide", () => {
    for (const v of REDESIGN_GUIDE) expect(guideShapeProblems(v.sections), v.screen).toEqual([]);
  });

  it("reads through the registry from the guide page, and the layout is not edited", () => {
    const page = readSource("src/app/(app)/guide/steps/page.tsx");
    expect(page).toMatch(/guideFor\(guideInClubWords\(words\), \[\.\.\.shown\]\)/);
    expect(page).toMatch(/mergesShown\(asked\.get\("x-search"\)/);
  });
});
