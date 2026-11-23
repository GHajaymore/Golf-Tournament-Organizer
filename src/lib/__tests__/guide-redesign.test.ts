import { describe, it, expect } from "vitest";
import { GUIDE_STEPS, type GuideSection } from "../guide-steps";
import { REDESIGN_GUIDE, guideFor, type GuideVariant } from "../guide/redesign";
import { golfTermsFor, GOLF_REGISTERS } from "../domain/golf-terms";
import { SCREEN_KEYS, type ScreenKey } from "../domain/console-merges";
import { guideShapeProblems } from "./guide-word-checks";
import { readSource } from "./source";
import { existsSync } from "node:fs";
import { join } from "node:path";

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

const US = golfTermsFor("us");

describe("a variant's words are the club's words", () => {
  it("fills {organizer} and every token for each register, before the variant is spliced in", () => {
    const v = variant({ sections: [section("tokens", "Ask your {organizer} about the {golfGroups}.")] });
    const uk = guideFor(BASE, [SCREEN], golfTermsFor("uk"), [v]);
    expect(JSON.stringify(uk)).toContain("Ask your organiser about the societies.");
    for (const register of GOLF_REGISTERS) {
      const out = guideFor(BASE, [SCREEN], golfTermsFor(register), [v]);
      expect(JSON.stringify(out), register).not.toMatch(/\{\w+\}/);
    }
  });
});

describe("the guide with the redesign's registry", () => {
  it("is IDENTICAL to GUIDE_STEPS for every set of shown screens that holds no registered screen", () => {
    const registered = new Set(REDESIGN_GUIDE.map((v) => v.screen));
    const others = SCREEN_KEYS.filter((k) => !registered.has(k));
    expect(others.length, "every screen is registered: this test would pass on nothing").toBeGreaterThan(0);
    const sets: ScreenKey[][] = [[], [...others], ...others.map((k) => [k])];
    for (const shown of sets) expect(guideFor(GUIDE_STEPS, shown, US)).toEqual(GUIDE_STEPS);
    expect(guideFor(GUIDE_STEPS, [...others], US)).toBe(GUIDE_STEPS);
  });

  it("draws a registered screen's variant only while that screen is shown (R2: courses, R9a: teeTimes)", () => {
    const teeTimes = guideFor(GUIDE_STEPS, ["teeTimes"], US);
    expect(teeTimes.map((s) => s.id)).toEqual([...GUIDE_STEPS.map((s) => s.id), "teetimes"]);
    expect(teeTimes.slice(0, GUIDE_STEPS.length)).toEqual(GUIDE_STEPS);
    const courses = guideFor(GUIDE_STEPS, ["courses"], US);
    expect(courses.map((s) => s.id)).toEqual([...GUIDE_STEPS.map((s) => s.id), "clubcourses"]);
    // Today's guide is not edited: every base section is still there, untouched.
    expect(courses.slice(0, GUIDE_STEPS.length)).toEqual(GUIDE_STEPS);
    // R3: Event adds its own section after the base, and edits none of it.
    const event = guideFor(GUIDE_STEPS, ["event"], US);
    expect(event.map((s) => s.id)).toEqual([...GUIDE_STEPS.map((s) => s.id), "eventscreen"]);
    expect(event.slice(0, GUIDE_STEPS.length)).toEqual(GUIDE_STEPS);
    // A screen with no variant yet is drawn as today's guide.
    expect(guideFor(GUIDE_STEPS, ["scoreEntry"], US)).toEqual(GUIDE_STEPS);
  });

  it("draws Staff & access and Members' history only while their screens are shown, replacing nothing (R7)", () => {
    const staff = guideFor(GUIDE_STEPS, ["clubSettings"], US);
    expect(staff.map((s) => s.id)).toEqual([...GUIDE_STEPS.map((s) => s.id), "clubaccess"]);
    expect(staff.slice(0, GUIDE_STEPS.length)).toEqual(GUIDE_STEPS);
    const members = guideFor(GUIDE_STEPS, ["members"], US);
    expect(members.map((s) => s.id)).toEqual([...GUIDE_STEPS.map((s) => s.id), "clubmembers"]);
    expect(members.slice(0, GUIDE_STEPS.length)).toEqual(GUIDE_STEPS);
  });

  it("draws the rounds variant in place of the rounds section, ids unchanged, while rounds is shown (R4)", () => {
    const rounds = guideFor(GUIDE_STEPS, ["rounds"], US);
    expect(rounds.map((s) => s.id)).toEqual(GUIDE_STEPS.map((s) => s.id));
    expect(rounds).not.toEqual(GUIDE_STEPS);
    expect(rounds.find((s) => s.id === "rounds")).not.toEqual(GUIDE_STEPS.find((s) => s.id === "rounds"));
  });

  it("a planted variant replaces exactly the sections it names, in place, while its screen is shown", () => {
    const out = guideFor(BASE, [SCREEN], US, [variant()]);
    expect(out.map((s) => s.id)).toEqual(["alpha", "newbeta", "delta"]);
  });

  it("…and is not drawn while its screen is not shown", () => {
    expect(guideFor(BASE, [], US, [variant()])).toEqual(BASE);
    expect(guideFor(BASE, [OTHER], US, [variant()])).toEqual(BASE);
  });

  it("a variant that replaces nothing is added after the last section", () => {
    const out = guideFor(BASE, [SCREEN], US, [variant({ replaces: [] })]);
    expect(out.map((s) => s.id)).toEqual(["alpha", "beta", "gamma", "delta", "newbeta"]);
  });

  it("two shown screens each swap their own", () => {
    const second = variant({ screen: OTHER, replaces: ["alpha"], sections: [section("newalpha", "x")] });
    const out = guideFor(BASE, [SCREEN, OTHER], US, [variant(), second]);
    expect(out.map((s) => s.id)).toEqual(["newalpha", "newbeta", "delta"]);
  });

  it("does not change the base it was handed", () => {
    const before = BASE.map((s) => s.id);
    guideFor(BASE, [SCREEN], US, [variant()]);
    expect(BASE.map((s) => s.id)).toEqual(before);
  });

  it("CONTROL: the sweep of a registry sees a variant that is wrong", () => {
    expect(guideShapeProblems([section("Bad Id", "x")])).not.toEqual([]);
    expect(guideShapeProblems([{ ...section("empty", "x"), blocks: [] }])).not.toEqual([]);
    expect(guideShapeProblems([section("same", "a"), section("same", "b")])).not.toEqual([]);
  });
});

describe("one guide file per screen (G1)", () => {
  const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
  const dir = join(process.cwd(), "src", "lib", "guide", "redesign");

  it("every screen key has its own file, and the registry names it", () => {
    const index = readSource("src/lib/guide/redesign/index.ts");
    for (const k of SCREEN_KEYS) {
      expect(existsSync(join(dir, `${kebab(k)}.ts`)), `${k} has no src/lib/guide/redesign/${kebab(k)}.ts`).toBe(true);
      expect(index, `${k} is not in the registry`).toMatch(new RegExp(`\\b${k}: [A-Z_]+_GUIDE,`));
      expect(index).toContain(`from "./${kebab(k)}"`);
    }
  });

  it("an unbuilt screen's file is null, and a null variant changes nothing", () => {
    for (const v of REDESIGN_GUIDE) expect(v, "a null must not reach the registry").not.toBeNull();
    // Every screen shown at once draws exactly the registered variants, and none for the unbuilt keys.
    const all = guideFor(GUIDE_STEPS, [...SCREEN_KEYS], US);
    expect(all.length).toBeGreaterThanOrEqual(GUIDE_STEPS.length);
    expect(REDESIGN_GUIDE.map((v) => v.screen)).toEqual(SCREEN_KEYS.filter((k) => REDESIGN_GUIDE.some((v) => v.screen === k)));
    // A key with no variant is drawn as today's guide (home is not built).
    expect(guideFor(GUIDE_STEPS, ["home"], US)).toEqual(GUIDE_STEPS);
  });
});

describe("every registered variant", () => {
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
    expect(page).toMatch(/guideFor\(guideInClubWords\(words\), \[\.\.\.shown\], words\)/);
    // Which screens are shown is asked of the one service (R1c), never of `mergesShown` itself.
    expect(page).toMatch(/screensShownFor\(session\)/);
  });
});
