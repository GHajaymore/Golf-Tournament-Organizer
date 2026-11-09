import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * THE CONSOLE CRAWL KNOWS A ROUND PICKER IS A VIEW (round G577-3, 2026-11-09).
 *
 * `RoundPicker` navigates to `?round=<id>`; nothing is saved. The pot card on
 * Prizes holds one beside a Save button. The crawl waited 700ms for the new
 * address, and on a slow runner it had not come: the crawl read "no request,
 * same address", pressed the card's Save (saveSkinsPot), reloaded the bare
 * path (which opens the current round) and reported the pick LOST.
 *
 * The picker now says it navigates (`data-view-picker="url"`) and the crawl
 * waits for the address. Both halves must stay: the attribute with nobody
 * reading it, or a reader with no attribute, brings the intermittent back.
 */
describe("the crawl and the round picker", () => {
  it("the picker's select says it navigates", () => {
    expect(readSource("src/components/RoundPicker.tsx")).toMatch(/data-view-picker="url"/);
  });

  it("the crawl reads that attribute and waits for the address before judging", () => {
    const spec = readSource("e2e/every-control.spec.ts");
    expect(spec).toMatch(/getAttribute\("data-view-picker"\)/);
    expect(spec).toMatch(/waitForURL\(/);
  });
});
