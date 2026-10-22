import { describe, it, expect } from "vitest";
import { addBelongsToBox, newlyShown, refusalGap, spacedValue } from "../../../e2e/text-box-reading";
import { readSource } from "./source";

/**
 * THE TEXT-BOX CRAWL'S OWN READINGS, held where they can be held without a browser.
 *
 * The first three rounds of the crawl on GitHub (2026-10-21) reported eleven findings. Four were the
 * app's. Seven were the crawl reading a correct screen wrong, each in one of the four ways below —
 * and a finding the crawl invents is chased in the app, or teaches everybody to stop believing it.
 * Each case is the screen as it was measured that day.
 */
describe("how far a refusal is from the press", () => {
  it("is measured on the page: a refusal that scrolls itself into view is still beside its box", () => {
    // Prizes, an amount box near the foot of the screen: measured at 740–776 before it was left,
    // the refusal under it appeared below the fold and brought itself up by 300px.
    const press = { top: 740, bottom: 776, scrollY: 0 };
    const refusal = { top: 478, bottom: 530, scrollY: 300 };
    expect(refusalGap(press, refusal)).toBe(2);
    // The reading that called it 223px off: both taken as places on the screen.
    expect(refusalGap({ ...press, scrollY: 0 }, { ...refusal, scrollY: 0 })).toBeGreaterThan(200);
  });

  it("CONTROL: a refusal really printed far from the press is still far from it", () => {
    // The crawl's own control prints one 4,000px below the press; and one at the head of a long
    // screen, scrolled to, is as far from the press after the scroll as before it.
    expect(refusalGap({ top: 600, bottom: 640, scrollY: 0 }, { top: 4640, bottom: 4660, scrollY: 0 })).toBeGreaterThan(200);
    expect(refusalGap({ top: 600, bottom: 640, scrollY: 2400 }, { top: 10, bottom: 40, scrollY: 0 })).toBeGreaterThan(2000);
  });
});

describe("whether what an Add form was given is on the screen afterwards", () => {
  const before = { text: "Entries\nCarla Pinto", values: ["carla@example.invalid"] };

  it("reads a box's value, which is how Entries shows a player's address", () => {
    const after = { text: "Entries\nCarla Pinto\nzz-Text Box 9", values: ["carla@example.invalid", "zz-text-box-9@example.invalid"] };
    expect(newlyShown("zz-text-box-9@example.invalid", before, after)).toBe(true);
    // The words alone, as the crawl first read the screen, do not hold it.
    expect(after.text.includes("zz-text-box-9@example.invalid")).toBe(false);
  });

  it("CONTROL: what was on the screen before, or is nowhere, is not newly shown", () => {
    const after = { text: "Entries\nCarla Pinto\nzz-Text Box 9", values: ["carla@example.invalid"] };
    expect(newlyShown("carla@example.invalid", before, after)).toBe(false);
    expect(newlyShown("zz-text-box-10@example.invalid", before, after)).toBe(false);
    expect(newlyShown("   ", before, after)).toBe(false);
  });
});

describe("which form an Add button belongs to", () => {
  it("an Add below the box, or in its form, is the box's", () => {
    expect(addBelongsToBox({ followsTheBox: true, sameForm: false })).toBe(true);
    expect(addBelongsToBox({ followsTheBox: false, sameForm: true })).toBe(true);
  });

  it("an Add above the box and outside any form with it is not — the side games' 'Add a game'", () => {
    // The stake boxes save as they are left; "Add a game" opens a contest's form at the card's head.
    expect(addBelongsToBox({ followsTheBox: false, sameForm: false })).toBe(false);
  });

  it("the crawl decides with it, outside the page", () => {
    const spec = readSource("e2e/every-text-box.spec.ts");
    expect(spec).toContain("addAt = { followsTheBox: after.includes(pick), sameForm };");
    expect(spec).toMatch(/b\.save\.how === "form" && b\.addAt && !addBelongsToBox\(b\.addAt\)/);
    expect(spec).toMatch(/refusalGap\(press, c\)/);
    expect(spec).toMatch(/newlyShown\(v, shownBefore, shownAfter\)/);
  });
});

describe("the spaces try", () => {
  it("never types what the good try will type, trimmed", () => {
    for (const [good, kind, max] of [
      ["zz-text-box@example.invalid", "email", 254],
      ["Braid Hollow zz", "name", 80],
      ["zz-Text Box 7", "name", 0],
      ["zz text box words", "words", 0],
      ["zz", "words", 6],
    ] as const) {
      const spaced = spacedValue(good, kind, max);
      expect(spaced.trim(), `${kind} "${good}"`).not.toBe(good);
      expect(spaced.startsWith("  ") && spaced.endsWith("  "), "it is still a try with spaces round it").toBe(true);
      if (max > 0) expect(spaced.length, "longer than the box takes").toBeLessThanOrEqual(max);
    }
    // An address stays an address, so the try asks about the spaces and nothing else.
    expect(spacedValue("zz-text-box@example.invalid", "email", 254).trim()).toBe("zz-text-box-sp@example.invalid");
  });

  it("the crawl builds both of its spaces tries with it", () => {
    const spec = readSource("e2e/every-text-box.spec.ts");
    expect(spec.match(/try: "bad: spaces", value: spacedValue\(goodFor\(b\), b\.kind, b\.maxLength\)/g)?.length).toBe(2);
    expect(spec).not.toContain("value: `  ${goodFor(b)}  `");
  });
});
