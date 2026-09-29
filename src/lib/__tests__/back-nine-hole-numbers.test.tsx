import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { applyNine } from "@/lib/services/course-resolution";
import { firstHoleForRound, firstHoleOf, holeNumber, startHoleNumber } from "@/lib/domain/hole-number";
import { ScorecardTable } from "@/components/ScorecardTable";
import { TeeSheetPrint } from "@/components/TeeSheetPrint";

/**
 * A NINE PLAYED OVER THE BACK NINE IS HOLES 10-18 (found 2026-09-29).
 *
 * Every screen printed `index + 1`, so a member standing on the 10th tee read
 * "Hole 1", the printed card headed its columns 1-9 under a course name saying
 * "(back nine)", and a shotgun group "starting on hole 3" walked to the 3rd.
 * The seeded club has no back-nine round, which is why no walk ever saw it.
 */

const EIGHTEEN = {
  name: "Braid Hollow",
  pars: [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4],
  yards: new Array(18).fill(400),
  strokeIndex: [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14],
};
const NINE_HOLE_COURSE = { ...EIGHTEEN, name: "Ardmore", pars: EIGHTEEN.pars.slice(0, 9), yards: EIGHTEEN.yards.slice(0, 9), strokeIndex: [5, 1, 7, 3, 9, 2, 8, 4, 6] };

describe("which number a card starts at", () => {
  it("is 10 on the back nine of an eighteen, and 1 everywhere else", () => {
    expect(firstHoleOf(applyNine(EIGHTEEN, "back", 9))).toBe(10);
    expect(firstHoleOf(applyNine(EIGHTEEN, "front", 9))).toBe(1);
    expect(firstHoleOf(applyNine(EIGHTEEN, "full", 9))).toBe(1);
    expect(firstHoleOf(applyNine(EIGHTEEN, "back", 18))).toBe(1);
    // A nine-hole course's holes ARE 1-9, whatever the round says.
    expect(firstHoleOf(applyNine(NINE_HOLE_COURSE, "full", 9))).toBe(1);
    expect(firstHoleOf(null)).toBe(1);
  });

  it("the round's answer agrees with the card's for every round that can be set up", () => {
    // Two readers of one question — pinned to agree, not merged (the card
    // reader is the one with the course in hand; the round reader is for a
    // push notice that has no card).
    for (const holes of [9, 18]) {
      for (const nine of ["full", "front", "back"]) {
        expect(firstHoleForRound({ holes, nine }), `${holes} holes, ${nine}`).toBe(
          firstHoleOf(applyNine(EIGHTEEN, nine as "full" | "front" | "back", holes)),
        );
      }
    }
  });

  it("numbers holes and start holes from it", () => {
    expect(holeNumber(0, 10)).toBe(10);
    expect(holeNumber(8, 10)).toBe(18);
    expect(holeNumber(0)).toBe(1);
    // A shotgun start is stored as a position on the card: the 3rd of the back nine is the 12th.
    expect(startHoleNumber(3, 10)).toBe(12);
    expect(startHoleNumber(3, 1)).toBe(3);
  });
});

describe("what a player and a committee actually read", () => {
  const card = applyNine(EIGHTEEN, "back", 9);

  it("the player's card heads its columns 10-18 and names each box by the course's hole", () => {
    const html = renderToStaticMarkup(
      <ScorecardTable holes={9} pars={card.pars} strokeIndex={card.strokeIndex} strokes={new Array(9).fill(null)} firstHole={firstHoleOf(card)} onSet={() => {}} />,
    );
    for (const n of [10, 14, 18]) expect(html).toContain(`<th>${n}</th>`);
    expect(html).not.toContain("<th>1</th>");
    // The 10th is a par 4 on this card: the box a screen reader lands on says so.
    expect(html).toContain('aria-label="Hole 10, par 4"');
  });

  it("CONTROL: the front nine still reads 1-9", () => {
    const front = applyNine(EIGHTEEN, "front", 9);
    const html = renderToStaticMarkup(
      <ScorecardTable holes={9} pars={front.pars} strokes={new Array(9).fill(null)} firstHole={firstHoleOf(front)} onSet={() => {}} />,
    );
    expect(html).toContain("<th>1</th>");
    expect(html).not.toContain("<th>10</th>");
  });

  it("the printed card heads 10-18 and sends a shotgun group to the 12th", () => {
    const html = renderToStaticMarkup(
      <TeeSheetPrint
        groups={[{ name: "Group 1", startHole: 3, time: "", players: [] }]}
        clubName="Braid Hollow"
        courseName={card.name}
        dates=""
        roundLabel="Round 1"
        pars={card.pars}
        strokeIndex={card.strokeIndex}
        holes={9}
        firstHole={firstHoleOf(card)}
      />,
    );
    expect(html).toContain("Hole 12");
    expect(html).not.toContain("Hole 3<");
  });
});
