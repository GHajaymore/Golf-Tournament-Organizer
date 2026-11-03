import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  holeStrip,
  holeTone,
  ladderGraphic,
  ladderOrder,
  pathGraphic,
  pointsGraphic,
  sideGraphic,
  toParFigure,
  weeksGraphic,
  type HeroGraphic,
} from "../report-graphics";
import type { HighlightRound } from "../report-highlights";
import { ReportGraphic, graphicTitle } from "@/components/report/ReportGraphics";

/**
 * THE REPORT'S PICTURES, worked by hand (2026-10-23). Each builder takes the
 * rows the table beside it is drawn from; the last block here draws every
 * kind and requires the picture's words and the table's to carry the same
 * names, in the same order, with the same figures — a graphic is never its
 * own reader. The browser spec (`e2e/report-rich.spec.ts`) asks the same of
 * the real pages.
 */

const round = (cards: Array<{ id: string; strokes: (number | null)[]; pickedUp?: boolean[] }>, pars = [4, 3, 5]): HighlightRound => ({
  stageId: "s1",
  label: "Round 1",
  holes: pars.length,
  firstHole: 1,
  pars,
  strokePlay: true,
  venue: "",
  cards: cards.map((c) => ({ playerId: c.id, name: c.id, strokes: c.strokes, pickedUp: c.pickedUp })),
});

describe("the ladder: the place after each round", () => {
  const rounds = [
    { label: "Round 1", rows: [{ playerId: "b", name: "Bob", value: 70, position: 1, change: 0, isNew: true }, { playerId: "a", name: "Ann", value: 72, position: 4, change: 0, isNew: true }, { playerId: "c", name: "Cat", value: 71, position: 2, change: 0, isNew: true }] },
    { label: "Round 2", rows: [] },
  ];
  const final = [
    { id: "a", name: "Ann", place: "1" },
    { id: "b", name: "Bob", place: "T2" },
    { id: "c", name: "Cat", place: "T2" },
  ];

  it("reads each earlier column off that round's table, and the last off the board", () => {
    const g = ladderGraphic({ rounds, final, shortLabel: (l) => l.replace("Round ", "R"), completed: true, cutAfterRound: "" })!;
    expect(g.columns).toEqual(["R1", "Final"]);
    expect(g.rows).toEqual([
      { name: "Ann", places: ["4", "1"] },
      { name: "Bob", places: ["1", "T2"] },
      { name: "Cat", places: ["2", "T2"] },
    ]);
    expect(g.caption).toBe("Ann came from 4th after R1 to win.");
  });

  it("says 'led after every round' only when the winner did, and 'leads' while it is played", () => {
    const g = ladderGraphic({
      rounds,
      final: [{ id: "b", name: "Bob", place: "1" }, final[0]],
      shortLabel: (l) => l,
      completed: false,
      cutAfterRound: "",
    })!;
    expect(g.caption).toBe("Bob has led after every round.");
  });

  it("is not drawn over one round: a ladder of one column is a list", () => {
    expect(ladderGraphic({ rounds: [rounds[0]], final, shortLabel: (l) => l, completed: true, cutAfterRound: "" })).toBeNull();
  });

  it("marks the cut after the round it was made", () => {
    const g = ladderGraphic({ rounds, final, shortLabel: (l) => l.replace("Round ", "R"), completed: true, cutAfterRound: "Round 1" })!;
    expect(g.cutAfter).toBe("R1");
  });

  it("draws each row where its place puts it in that column, level places in the board's order", () => {
    const g = ladderGraphic({ rounds, final, shortLabel: (l) => l, completed: true, cutAfterRound: "" })!;
    expect(ladderOrder(g.rows, 0)).toEqual([2, 0, 1]);
    expect(ladderOrder(g.rows, 1)).toEqual([0, 1, 2]);
  });
});

describe("the hole strip: each hole's average gross against par", () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, strokes: [5, 3, 5] as (number | null)[] }));

  it("needs eight cards before an average says anything", () => {
    expect(holeStrip(round(eight.slice(0, 7)))).toBeNull();
    expect(holeStrip(round(eight))).not.toBeNull();
  });

  it("averages the gross on each hole, worded to one place with a true minus", () => {
    // The 2nd: two 2s and six 3s is 2.75, written 2.8 — and so 0.2 under par, never a figure that disagrees with it.
    const cards = eight.map((c, i) => ({ ...c, strokes: [i < 4 ? 5 : 4, i < 2 ? 2 : 3, 5] }));
    const g = holeStrip(round(cards))!;
    expect(g.cells.map((c) => c.figure)).toEqual(["+0.5", "−0.2", "0.0"]);
    expect(g.cells.map((c) => c.average)).toEqual(["4.5", "2.8", "5.0"]);
    expect(g.cells.map((c) => holeTone(c.overPar))).toEqual(["over", "under", "level"]);
    expect(g.caption).toBe("The 1st was the hardest, 4.5 on average for a par 4; the 2nd the easiest, 2.8 for a par 3.");
  });

  it("leaves a picked-up hole out of the average — and a hole nobody scored on has no figure", () => {
    const cards = eight.map((c) => ({ ...c, strokes: [8, 3, 5], pickedUp: [true, false, false] }));
    const g = holeStrip(round(cards))!;
    expect(g.cells[0].figure).toBe("");
    expect(g.cells[0].overPar).toBeNull();
    expect(g.caption).not.toMatch(/1st/);
    // Control: the same 8s, not picked up, are the hardest hole.
    expect(holeStrip(round(cards.map((c) => ({ ...c, pickedUp: undefined }))))!.caption).toMatch(/^The 1st was the hardest/);
  });

  it("rounds before it signs: −0.04 is level", () => {
    expect(toParFigure(-0.04)).toBe("0.0");
    expect(holeTone(-0.04)).toBe("level");
  });

  it("works the figure off the average it prints: 3.45 on a par 3 is 3.5, so +0.5", () => {
    // 20 scores: eleven 3s and nine 4s = 3.45. Rounded on its own, +0.45 is +0.5 here only by luck.
    const cards = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, strokes: [4, i < 11 ? 3 : 4, 5] as (number | null)[] }));
    const c = holeStrip(round(cards))!.cells[1];
    expect([c.average, c.figure]).toEqual(["3.5", "+0.5"]);
  });
});

describe("the points ladder", () => {
  it("is the board's rows, in its order, each bar against the longest", () => {
    const g = pointsGraphic(
      [
        { place: "1", name: "Ann", points: 40 },
        { place: "2", name: "Bob", points: 38 },
        { place: "", name: "Nobody", points: 0 },
      ],
      true,
    )!;
    expect(g.rows.map((r) => r.name)).toEqual(["Ann", "Bob"]);
    expect(g.most).toBe(40);
    expect(g.caption).toBe("Ann won on 40 points, 2 clear.");
  });

  it("says a countback when the next is level, and a tie when the place is shared", () => {
    expect(pointsGraphic([{ place: "1", name: "Ann", points: 40 }, { place: "2", name: "Bob", points: 40 }], true)!.caption).toBe(
      "Ann won on 40 points, on countback.",
    );
    expect(pointsGraphic([{ place: "T1", name: "Ann", points: 40 }, { place: "T1", name: "Bob", points: 40 }], true)!.caption).toBe(
      "Ann and Bob finished level on 40 points.",
    );
  });
});

describe("a side's card", () => {
  it("marks whose ball counted, and counts them", () => {
    const g = sideGraphic({
      side: "Ann & Bob",
      round: "",
      basis: "gross",
      shared: false,
      firstHole: 1,
      pars: [4, 3, 5],
      holes: [
        { gross: 3, net: 3, playerId: "a" },
        { gross: 3, net: 3, playerId: "b" },
        { gross: 5, net: 5, playerId: "a" },
      ],
      names: new Map([
        ["a", "Ann"],
        ["b", "Bob"],
      ]),
    })!;
    expect(g.holes.map((h) => [h.score, h.by, h.toPar])).toEqual([
      [3, "Ann", -1],
      [3, "Bob", 0],
      [5, "Ann", 0],
    ]);
    expect(g.caption).toBe("Ann & Bob: Ann's ball alone counted on 2 and Bob's ball alone counted on 1.");
  });

  it("credits a hole where the partners were level to both, not to whoever went first", () => {
    const g = sideGraphic({
      side: "Ann & Bob",
      round: "",
      basis: "gross",
      shared: false,
      firstHole: 1,
      pars: [4, 3, 5],
      holes: [
        { gross: 4, net: 4, playerId: "a" },
        { gross: 2, net: 2, playerId: "b" },
        { gross: 5, net: 5, playerId: "a" },
      ],
      names: new Map([
        ["a", "Ann"],
        ["b", "Bob"],
      ]),
      level: [true, false, true],
    })!;
    expect(g.holes.map((h) => h.by)).toEqual(["both", "Bob", "both"]);
    expect(g.caption).toBe("Ann & Bob: Bob's ball alone counted on 1; level on 2.");
  });

  it("names nobody's ball on a shared ball", () => {
    const g = sideGraphic({
      side: "Ann & Bob",
      round: "",
      basis: "net",
      shared: true,
      firstHole: 1,
      pars: [4, 3],
      holes: [
        { gross: 4, net: 3, playerId: "" },
        { gross: 3, net: 3, playerId: "" },
      ],
      names: new Map(),
    })!;
    expect(g.holes.every((h) => h.by === "")).toBe(true);
    expect(g.caption).toBe("Ann & Bob: one hole under par net.");
  });
});

describe("a knockout: the champion's path", () => {
  const slot = (playerId: string | null, name: string, seed: number | null) => ({ playerId, name, seed });
  const rounds = [
    {
      label: "Quarterfinals",
      matches: [
        { key: "w-0-0", winnerId: "c", a: slot("a", "Ann", 1), b: slot("c", "Cat", 8) },
        { key: "w-0-1", winnerId: "d", a: slot("d", "Dot", 2), b: slot(null, "Bye", null) },
      ],
    },
    { label: "Final", matches: [{ key: "w-1-0", winnerId: "c", a: slot("c", "Cat", 8), b: slot("d", "Dot", 2) }] },
  ];
  const margin = (k: string) => (k === "w-1-0" ? " at the 19th" : " 3&2");

  it("lists each tie the champion won, with its margin, and flags an upset where the draw was seeded", () => {
    const g = pathGraphic({ champion: { id: "c", name: "Cat", seed: 8 }, rounds, margin, seeded: true })!;
    expect(g.steps).toEqual([
      { round: "Quarterfinals", opponent: "Ann", margin: " 3&2", upset: true },
      { round: "Final", opponent: "Dot", margin: " at the 19th", upset: true },
    ]);
    expect(g.caption).toBe("Cat won 2 ties, beating Dot in the final at the 19th. 2 against a higher seed.");
  });

  it("flags no upset in a draw nobody seeded, and counts no bye as a tie", () => {
    const g = pathGraphic({ champion: { id: "d", name: "Dot", seed: 2 }, rounds: [rounds[0], { label: "Final", matches: [{ ...rounds[1].matches[0], winnerId: "d" }] }], margin, seeded: false })!;
    expect(g.steps.map((s) => s.opponent)).toEqual(["Cat"]);
    expect(g.steps.some((s) => s.upset)).toBe(false);
  });
});

describe("a league: the table with a dot a week", () => {
  it("counts who played every week, and keeps the board's order", () => {
    const g = weeksGraphic({
      rows: [
        { place: "1", name: "Ann", points: "70", played: 2, weeks: [true, true], move: 1 },
        { place: "2", name: "Bob", points: "66", played: 1, weeks: [false, true], move: -1 },
      ],
      columns: ["R1", "R2"],
      unit: "Points",
      completed: true,
    })!;
    expect(g.rows.map((r) => r.name)).toEqual(["Ann", "Bob"]);
    expect(g.caption).toBe("Ann topped the table on 70. One player played every week.");
  });
});

/* ------------------------------------------------------------------------ */
/*  A graphic is never its own reader                                       */
/* ------------------------------------------------------------------------ */

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** The picture's words: what is drawn between the caption and the table, the key left out. */
function pictureText(html: string): string {
  const drawn = html
    .split("<table")[0]
    .replace(/<h2[\s\S]*?<\/h2>/, "")
    .replace(/<figcaption[\s\S]*?<\/figcaption>/, "")
    .replace(/<p class="fr-key"[\s\S]*?<\/p>/g, "");
  return text(drawn);
}

/** The table's cells, row by row. */
function tableRows(html: string): string[][] {
  const table = /<table[^>]*>([\s\S]*?)<\/table>/.exec(html)?.[1] ?? "";
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(table)?.[1] ?? "";
  return [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => text(c[1])));
}

const draw = (g: HeroGraphic) => renderToStaticMarkup(createElement(ReportGraphic, { graphic: g, title: graphicTitle(g) }));

describe("a graphic and its table carry the same names, order and figures", () => {
  it("the points ladder", () => {
    const g = pointsGraphic(
      [
        { place: "1", name: "Ann Example", points: 40 },
        { place: "2", name: "Bob Example", points: 38 },
        { place: "3", name: "Cat Example", points: 31 },
      ],
      true,
    )!;
    const html = draw(g);
    const rows = tableRows(html);
    expect(rows).toEqual([
      ["1", "Ann Example", "40"],
      ["2", "Bob Example", "38"],
      ["3", "Cat Example", "31"],
    ]);
    // The bars read the same three, in the same order, with the same figures.
    expect(pictureText(html)).toBe(rows.map((r) => r.join(" ")).join(" "));
  });

  it("the hole strip", () => {
    const cards = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, strokes: [i < 4 ? 5 : 4, 3, 6] as (number | null)[] }));
    const g = holeStrip(round(cards))!;
    const html = draw(g);
    const rows = tableRows(html);
    expect(rows.map((r) => [r[0], r[3]])).toEqual(g.cells.map((c) => [String(c.hole), c.figure || "–"]));
    // Every hole's figure in the strip, in hole order.
    const strip = pictureText(html);
    const at = g.cells.map((c) => strip.indexOf(`${c.hole} ${c.figure}`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("the ladder", () => {
    const g = ladderGraphic({
      rounds: [{ label: "Round 1", rows: [{ playerId: "a", name: "Ann Example", value: 70, position: 2, change: 0, isNew: true }, { playerId: "b", name: "Bob Example", value: 69, position: 1, change: 0, isNew: true }] }, { label: "Round 2", rows: [] }],
      final: [
        { id: "a", name: "Ann Example", place: "1" },
        { id: "b", name: "Bob Example", place: "2" },
      ],
      shortLabel: (l) => l.replace("Round ", "R"),
      completed: true,
      cutAfterRound: "",
    })!;
    const html = draw(g);
    expect(tableRows(html)).toEqual([
      ["Ann Example", "2", "1"],
      ["Bob Example", "1", "2"],
    ]);
    // The drawing names both, at both ends, and prints every place in the table.
    const pic = pictureText(html);
    for (const r of g.rows) for (const p of r.places) expect(pic).toContain(p);
    expect(pic.match(/Ann E\./g)).toHaveLength(2);
    expect(pic.match(/Bob E\./g)).toHaveLength(2);
  });
});
