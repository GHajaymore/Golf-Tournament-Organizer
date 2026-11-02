import { describe, it, expect } from "vitest";
import { heldInstead, holdsTheSame, howItSaves, newlyShown, refusalGap, spacedValue, type Matched } from "../../../e2e/text-box-reading";
import { readSource } from "./source";

/**
 * THE TEXT-BOX CRAWL'S OWN READINGS, held where they can be held without a browser.
 *
 * The first three rounds of the crawl on GitHub (2026-10-21) reported eleven findings, the same each
 * time. One was the app's (`the-text-box-crawl-found.test.tsx`). Ten were the crawl reading a
 * correct screen wrong, in the ways below — and a finding the crawl invents is chased in the app, or
 * teaches everybody to stop believing it.
 */
describe("how far a refusal is from the press", () => {
  it("is measured on the page: a refusal that scrolls itself into view is still beside its box", () => {
    // A box near the foot of the screen, measured at 740–776 before it was left; the refusal under
    // it appears below the fold and brings itself up by 300px.
    const press = { top: 740, bottom: 776, scrollY: 0 };
    const refusal = { top: 478, bottom: 530, scrollY: 300 };
    expect(refusalGap(press, refusal)).toBe(2);
    // Read as two places on the screen, it is as far off as the page moved.
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

describe("how a box is saved, once the nearest button has been found", () => {
  const m = (over: Partial<Matched>): Matched => ({ how: "form", followsTheBox: true, sameForm: false, sameCard: true, actsOnLeave: false, ...over });

  it("a box that saves as it is left is not another form's: the side games' stake and 'Add a sponsor'", () => {
    // Every stake box saves when it is left. The nearest Add after it was a contest's "Add a sponsor",
    // in the same card, which opens a form of its own.
    expect(howItSaves(m({ how: "form", actsOnLeave: true }))).toBe("leave");
  });

  it("nor another card's Save: a prize's amount and the skins pot's Save below it", () => {
    expect(howItSaves(m({ how: "save", sameCard: false, actsOnLeave: true }))).toBe("leave");
  });

  it("an Add above a box, outside any form with it, is not the box's: the card's 'Add a game'", () => {
    expect(howItSaves(m({ how: "form", followsTheBox: false }))).toBe("leave");
  });

  it("CONTROL: an Add form's own boxes, and a card's own Save, are still pressed", () => {
    // Entries' "Add someone new": boxes that do nothing when left, the Add after them.
    expect(howItSaves(m({ how: "form" }))).toBe("form");
    // A form in a <form>, even where a box also checks itself when left.
    expect(howItSaves(m({ how: "form", sameForm: true, actsOnLeave: true, followsTheBox: false }))).toBe("form");
    // Club settings' name and its Save, in one card, whatever the box does when left.
    expect(howItSaves(m({ how: "save" }))).toBe("save");
    expect(howItSaves(m({ how: "save", actsOnLeave: true }))).toBe("save");
    // A Save in another card, for a box that does nothing when left, is still the nearest Save.
    expect(howItSaves(m({ how: "save", sameCard: false }))).toBe("save");
  });

  it("the crawl decides with it, outside the page", () => {
    const spec = readSource("e2e/every-text-box.spec.ts");
    expect(spec).toContain("actsOnLeave: typeof props?.onBlur === \"function\",");
    expect(spec).toContain('addAt = { how: "save", ...where };');
    expect(spec).toContain('addAt = { how: "form", ...where };');
    expect(spec).toMatch(/howItSaves\(b\.addAt\) === "leave"/);
    expect(spec).toMatch(/refusalGap\(press, c\)/);
    expect(spec).toMatch(/newlyShown\(v, shownBefore, shownAfter\)/);
  });
});

describe("a box that will not hold what was typed has said no, where the typing was", () => {
  it("emptied and reading its figure again at once: Rounds & formats' 'How many?'", () => {
    // Emptied, it reads "1" before anything is left or pressed: nothing to send, the refusal is the box.
    expect(heldInstead("empty", "1", "")).toBe("refused");
    expect(heldInstead("bad: letters", "1", "-1")).toBe("refused");
    expect(heldInstead("over-long", "zzxx", "zzxxxxxxxx")).toBe("cut");
  });

  it("CONTROL: a box holding what was typed, or a good value the box reshaped, is not a refusal", () => {
    expect(heldInstead("empty", "", "")).toBeNull();
    expect(heldInstead("bad: spaces", "zz sp", "  zz sp  ")).toBeNull();
    // A good value is read back after the save, by `judge`.
    expect(heldInstead("good", "10.00", "10")).toBeNull();
  });

  it("the crawl reads every try with it, the empty one included", () => {
    const spec = readSource("e2e/every-text-box.spec.ts");
    expect(spec).toContain("const held = sabotage ? null : heldInstead(t, typed, value);");
    expect(spec).not.toContain('t !== "good" && t !== "empty"');
  });
});

describe("whether a box was put back as it was", () => {
  it("a figure that held nothing and reads nought holds the same thing", () => {
    // A side game's stake: "" before any game, "0.00" once the game made and emptied is still there.
    expect(holdsTheSame("figure", "0.00", "")).toBe(true);
    expect(holdsTheSame("figure", "40.00", "40")).toBe(true);
    expect(holdsTheSame("figure", "12,5", "12.5")).toBe(true);
  });

  it("CONTROL: a figure that is not nought, a word box, and junk are not the same as empty", () => {
    expect(holdsTheSame("figure", "10.00", "")).toBe(false);
    expect(holdsTheSame("words", "0", "")).toBe(false);
    expect(holdsTheSame("name", "zz-Club", "zz-Club zz")).toBe(false);
    expect(holdsTheSame("figure", "abc", "")).toBe(false);
  });

  it("the crawl's putting back reads with it", () => {
    const spec = readSource("e2e/every-text-box.spec.ts");
    expect(spec.match(/holdsTheSame\(b\.kind, (now|back)\.value, b\.value\)/g)?.length).toBe(2);
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
