import { describe, expect, it } from "vitest";
import SHOT_WIDTHS from "@/lib/landing/shot-widths.json";
import { SCREENS } from "@/lib/landing/screens";
import { PIPELINE, type PipelineFeature } from "@/app/new/pipeline";
import { readSource } from "./source";

/**
 * THE SITE REHAUL'S PIPELINE SWITCHES (design F, 2026-11-03): a section for a feature still in a pull
 * request is drawn only when its switch is on, and a switch may be on only when every screen the
 * section draws is in the manifest and has been placed. The front door never claims what is not true
 * on the day it shows, and never shows a picture that is not a capture of the app.
 */
const placed = (id: string) => {
  const e = (SHOT_WIDTHS as Record<string, { w: number; h?: number }>)[id];
  return Boolean(e && e.h);
};

/** What is wrong with a switch, in words; empty when it may stand as it is. */
function refusals(name: string, f: PipelineFeature): string[] {
  if (!f.on) return [];
  const out: string[] = [];
  for (const id of f.screens) {
    const s = SCREENS.find((x) => x.id === id);
    if (!s) out.push(`${name} is on, but "${id}" is not in src/lib/landing/screens.ts`);
    else if (!s.onPage) out.push(`${name} is on, but "${id}" is not marked onPage`);
    if (!placed(id)) out.push(`${name} is on, but "${id}" was never placed (run the Landing captures workflow)`);
  }
  return out;
}

describe("the site rehaul's pipeline switches", () => {
  for (const [name, f] of Object.entries(PIPELINE)) {
    it(`${name} (#${f.pr}) is off, or every screen it draws is real and placed`, () => {
      expect(refusals(name, f)).toEqual([]);
      expect(f.screens.length, "a section with no screen").toBeGreaterThan(0);
      expect(f.when.length, "a switch must say when it may be turned on").toBeGreaterThan(20);
    });
  }

  it("CONTROL: a switch turned on before its screen exists is refused", () => {
    const early: PipelineFeature = { on: true, pr: 0, when: "a control, never a real switch at all", screens: ["zz-not-a-screen"] };
    expect(refusals("control", early).join(" ")).toMatch(/not in src\/lib\/landing\/screens\.ts/);
    expect(refusals("control", early).join(" ")).toMatch(/never placed/);
  });

  it("the page asks each switch, and draws no pipeline screen outside it", () => {
    const page = readSource("src/app/new/page.tsx");
    for (const [name, f] of Object.entries(PIPELINE)) {
      expect(page, `page.tsx never asks PIPELINE.${name}.on`).toContain(`PIPELINE.${name}.on`);
      for (const id of f.screens) {
        // Each pipeline screen is named once, inside its own switched section (as `${name}` ids).
        const uses = page.split(`"${id}"`).length - 1;
        expect(uses, `${id} is drawn ${uses} times; once, inside its section`).toBeLessThanOrEqual(1);
      }
    }
  });
});
