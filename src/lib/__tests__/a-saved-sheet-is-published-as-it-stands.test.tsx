import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams("") }));
vi.mock("@/app/actions/tee-sheet", () => ({ saveTeeSheet: vi.fn(), setTeeSheetPublished: vi.fn() }));

import { FoursomeMaker } from "@/components/FoursomeMaker";
import { drawTimesFrom, sameSheet, sheetStatusLine, type TeeSheetGroup } from "@/lib/domain/tee-sheet";
import { readSource } from "./source";

/**
 * A SAVED TEE SHEET IS PUBLISHED AS IT STANDS, AND THE SCREEN SAYS WHAT IS ON IT.
 *
 * The eve of the first real tournament (2026-10-17): Round 1's sheet was saved
 * right — off the 10th from 12:45, nine minutes apart — as a draft. Publishing
 * it meant "Re-draw this sheet", which reset the draw to 8:00 and ten minutes,
 * and "Save & publish" publishes the draw ON SCREEN; the times had to be typed
 * back in by hand. Then the line under it said "Published to players — this is
 * a new draw, not the saved sheet" about the sheet just published.
 *
 * The times below are the cup's own shape, with invented players.
 */

const CUP: TeeSheetGroup[] = [
  { name: "Group 1", startHole: 10, time: "12:45 PM", playerIds: ["a", "b", "c", "d"] },
  { name: "Group 2", startHole: 10, time: "12:54 PM", playerIds: ["e", "f", "g", "h"] },
  { name: "Group 3", startHole: 10, time: "1:03 PM", playerIds: ["i", "j", "k", "l"] },
];
const field = "abcdefghijkl".split("").map((id, i) => ({ id, name: `zz Player ${id.toUpperCase()}`, handicap: i, seed: i + 1 }));

describe("a re-draw starts from the saved sheet's times", () => {
  it("12:45 PM at nine-minute intervals reads back as 12:45 and 9", () => {
    expect(drawTimesFrom(CUP)).toEqual({ firstTee: "12:45", interval: 9 });
  });

  it("reads the twelve-hour clock right at both noon and midnight, and the 24-hour clock", () => {
    expect(drawTimesFrom([{ ...CUP[0], time: "12:05 AM" }])).toEqual({ firstTee: "00:05" });
    expect(drawTimesFrom([{ ...CUP[0], time: "8:10 AM" }, { ...CUP[1], time: "8:20 AM" }])).toEqual({ firstTee: "08:10", interval: 10 });
    expect(drawTimesFrom([{ ...CUP[0], time: "13:05" }, { ...CUP[1], time: "13:13" }])).toEqual({ firstTee: "13:05", interval: 8 });
  });

  it("takes the interval from the same tee only — a split start's 1st and 10th go off together", () => {
    const split = [
      { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: ["a"] },
      { name: "Group 2", startHole: 10, time: "8:00 AM", playerIds: ["b"] },
      { name: "Group 3", startHole: 1, time: "8:09 AM", playerIds: ["c"] },
    ];
    expect(drawTimesFrom(split)).toEqual({ firstTee: "08:00", interval: 9 });
  });

  it("CONTROL: a time it cannot read leaves the defaults rather than guessing", () => {
    expect(drawTimesFrom([{ ...CUP[0], time: "오후 12:45" }])).toEqual({});
    expect(drawTimesFrom([])).toEqual({});
  });

  it("the screen's re-draw starts from the saved times (the controls are shut over a saved sheet, so this reads the wiring)", () => {
    const src = readSource("src/components/FoursomeMaker.tsx");
    expect(src).toMatch(/const savedTimes = drawTimesFrom\(savedGroups\);/);
    expect(src).toMatch(/useState\(savedTimes\.firstTee \?\? "08:00"\)/);
    expect(src).toMatch(/useState\(savedTimes\.interval \?\? 10\)/);
  });

  it("CONTROL: with nothing saved the draw still opens at 8:00", () => {
    expect(renderToStaticMarkup(<FoursomeMaker players={field} stageId="s1" savedGroups={[]} />)).toContain('value="08:00"');
  });
});

describe("a saved draft is published as it stands", () => {
  it("offers Publish this sheet on a saved draft", () => {
    const html = renderToStaticMarkup(
      <FoursomeMaker players={field} stageId="s1" savedAt="2026-10-17T22:00:00.000Z" savedGroups={CUP} />,
    );
    expect(html).toContain("Publish this sheet");
  });

  it("CONTROL: not once it is published, and not where nothing is saved", () => {
    const published = renderToStaticMarkup(
      <FoursomeMaker players={field} stageId="s1" savedAt="2026-10-17T22:00:00.000Z" published savedGroups={CUP} />,
    );
    expect(published).not.toContain("Publish this sheet");
    expect(renderToStaticMarkup(<FoursomeMaker players={field} stageId="s1" savedGroups={[]} />)).not.toContain("Publish this sheet");
  });
});

describe("the line under the draw says what is on screen", () => {
  it("the sheet just published is the sheet they have — never 'a new draw'", () => {
    const line = sheetStatusLine({ published: true, onScreenIsSaved: true });
    expect(line).toBe("Published to players — this is the sheet they have.");
    expect(line).not.toMatch(/new draw|not saved/);
  });

  it("a draw that differs says so, and says what the players still have", () => {
    expect(sheetStatusLine({ published: true, onScreenIsSaved: false })).toMatch(/new and not saved\. Players still have the published sheet/);
    expect(sheetStatusLine({ published: false, onScreenIsSaved: false })).toMatch(/The saved sheet is unchanged/);
  });

  it("two sheets are the same when the same people go off the same tee at the same time, whatever the groups are called", () => {
    expect(sameSheet(CUP, CUP.map((g, i) => ({ ...g, name: `Tee time ${i + 1}` })))).toBe(true);
    expect(sameSheet(CUP, [{ ...CUP[0], time: "12:46 PM" }, CUP[1], CUP[2]])).toBe(false);
    expect(sameSheet(CUP, [{ ...CUP[0], playerIds: ["a", "b", "c", "e"] }, CUP[1], CUP[2]])).toBe(false);
    expect(sameSheet(CUP, CUP.slice(0, 2))).toBe(false);
  });
});
