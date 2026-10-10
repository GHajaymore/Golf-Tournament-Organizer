import { describe, it, expect } from "vitest";
import { GUIDE_STEPS } from "../guide-steps";
import { guideIndex, headingAnchor, plainGuideText, searchGuide } from "../guide-search";
import { readSource } from "./source";

/**
 * SEARCH OVER THE ORGANIZER'S GUIDE (Ajay, 2026-10-10) — a filter over the
 * guide's own words, chosen over an AI help bot. It can only ever return a
 * place in the guide, so what is pinned is that it FINDS the place a secretary
 * means, and that the place exists on the page to jump to.
 */
const index = guideIndex(GUIDE_STEPS);

describe("searching the guide", () => {
  it("finds the heading a one-word question means, first", () => {
    expect(searchGuide(index, "cut")[0]).toMatchObject({ heading: "Set a cut", section: "Part 3 · Rounds and formats" });
    expect(searchGuide(index, "flights")[0].heading).toBe("Flights");
    expect(searchGuide(index, "tee sheet")[0].heading).toBe("Tee sheet");
  });

  it("reads into the steps, not only the headings, and whatever the case", () => {
    const hits = searchGuide(index, "ROUND CODE");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => `${h.heading} ${h.text}`.toLowerCase().includes("round code"))).toBe(true);
  });

  it("finds a thing by the name the app's screens use, where the guide spells it another way", () => {
    // The guide says "Waitlist"; the entry screens say "waiting list". The
    // literal search returned nothing for the phrase a secretary would type.
    expect(index.some((e) => e.text.toLowerCase().includes("waiting list"))).toBe(false);
    const hits = searchGuide(index, "waiting list");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => /waitlist/i.test(h.text))).toBe(true);
    // And the other way round, and for a tee time against the Tee sheet.
    expect(searchGuide(index, "tee times").some((h) => h.heading === "Tee sheet")).toBe(true);
  });

  it("needs every word, and gives one result per place", () => {
    const hits = searchGuide(index, "approve cards");
    expect(hits.every((h) => /approve/i.test(`${h.heading} ${h.text}`) && /cards/i.test(`${h.heading} ${h.text}`))).toBe(true);
    expect(new Set(hits.map((h) => h.anchor)).size).toBe(hits.length);
  });

  it("CONTROL: finds nothing for nonsense, an empty box or a single letter", () => {
    expect(searchGuide(index, "zzqx-not-in-any-guide")).toEqual([]);
    expect(searchGuide(index, "   ")).toEqual([]);
    expect(searchGuide(index, "a")).toEqual([]);
  });

  it("prints the guide's button and bold marks as plain words", () => {
    expect(plainGuideText("Tap [[Launch tournament]] when **everything** is set.")).toBe("Tap Launch tournament when everything is set.");
    expect(index.some((e) => e.text.includes("[[") || e.text.includes("**"))).toBe(false);
  });
});

describe("where a result jumps to", () => {
  it("is a part of the guide or one of its headings — an anchor the page draws", () => {
    const anchors = new Set<string>();
    for (const s of GUIDE_STEPS) {
      anchors.add(s.id);
      s.blocks.forEach((b, i) => {
        if (b.kind === "h") anchors.add(headingAnchor(s.id, i));
      });
    }
    expect(index.length).toBeGreaterThan(100);
    expect(index.filter((e) => !anchors.has(e.anchor))).toEqual([]);
  });

  it("is drawn by the page through the same rule the index uses", () => {
    const page = readSource("src/app/(app)/guide/steps/page.tsx");
    expect(page).toMatch(/<Block key=\{i\} b=\{b\} anchor=\{headingAnchor\(s\.id, i\)\} \/>/);
    expect(page).toMatch(/<h3 id=\{anchor\}/);
    expect(page).toMatch(/<GuideSearch index=\{guideIndex\(GUIDE_STEPS\)\} \/>/);
  });
});
