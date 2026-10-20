import { describe, expect, it } from "vitest";
import {
  playerRecords,
  stars,
  pointsTrack,
  marginWords,
  reportStory,
  reportRibbon,
  sessionInSentence,
  sessionDescription,
  scoringWords,
  placeFigure,
  eventRibbon,
  eventStory,
  type ReportSession,
} from "@/lib/domain/final-report";

/**
 * Worked by hand from a cup shaped like the first real one: five four-balls
 * and ten singles, invented names. Side A is the left team, B the right.
 */
const W = (a: string[], b: string[], winner: "A" | "B" | "H", label: string) => ({
  a,
  b,
  points: (winner === "A" ? [1, 0] : winner === "B" ? [0, 1] : [0.5, 0.5]) as [number, number],
  final: true,
  label,
});
const sessions: ReportSession[] = [
  {
    name: "Four-balls",
    matches: [
      W(["A1", "A2"], ["B1", "B2"], "B", "2&1"),
      W(["A3", "A4"], ["B3", "B4"], "B", "3&2"),
      W(["A5", "A6"], ["B5", "B6"], "A", "3&2"),
    ],
  },
  {
    name: "Singles",
    matches: [
      W(["A1"], ["B2"], "A", "1 UP"),
      W(["A2"], ["B1"], "B", "2&1"),
      W(["A5"], ["B5"], "H", "A/S"),
      W(["A6"], ["B6"], "A", "1 UP"),
      { a: ["A3"], b: ["B3"], points: [0, 0] as [number, number], final: false, label: "2 UP thru 5" },
    ],
  },
];

describe("the final report's arithmetic", () => {
  it("credits every player on the side with the match's points, decided matches only", () => {
    const r = new Map(playerRecords(sessions).map((p) => [`${p.side}:${p.name}`, p]));
    expect(r.get("B:B1")).toMatchObject({ played: 2, points: 2 });
    expect(r.get("A:A5")).toMatchObject({ played: 2, points: 1.5 });
    expect(r.get("B:B5")).toMatchObject({ played: 2, points: 0.5 });
    // A3's singles is still on the course: one match played, not two.
    expect(r.get("A:A3")).toMatchObject({ played: 1, points: 0 });
  });

  it("lists the best first, then by name", () => {
    expect(playerRecords(sessions).slice(0, 2).map((p) => p.name)).toEqual(["A6", "B1"]);
  });

  it("a star won every one of at least two matches, and says how", () => {
    expect(stars(sessions)).toEqual([
      { name: "A6", side: "A", played: 2, how: ["Four-ball 3&2", "Singles 1 up"] },
      { name: "B1", side: "B", played: 2, how: ["Four-ball 2&1", "Singles 2&1"] },
    ]);
  });

  it("a halve is not unbeaten-and-won, and one match is not enough", () => {
    const names = stars(sessions).map((s) => s.name);
    expect(names).not.toContain("A5");
    expect(names).not.toContain("B3");
  });

  it("the points track: 16 points, CVC 5½, CDG 9½ in the matches and the 16th point to CDG", () => {
    expect(pointsTrack({ a: 5.5, b: 10.5, outside: [{ side: "B", points: 1 }], inPlay: 16 })).toEqual({
      a: 11,
      b: 19,
      outsideA: 0,
      outsideB: 2,
      open: 0,
      cells: 32,
    });
  });

  it("an undecided point outside the matches is an open cell, in nobody's colour", () => {
    expect(pointsTrack({ a: 7.5, b: 7.5, outside: [{ side: null, points: 1 }], inPlay: 16 })).toEqual({
      a: 15,
      b: 15,
      outsideA: 0,
      outsideB: 0,
      open: 2,
      cells: 32,
    });
  });

  it("a point outside the matches to side A is drawn at A's end, and taken out of A's match cells", () => {
    expect(pointsTrack({ a: 9, b: 7, outside: [{ side: "A", points: 1 }], inPlay: 16 })).toMatchObject({
      a: 16,
      outsideA: 2,
      b: 14,
      outsideB: 0,
      open: 0,
    });
  });

  /*
   * The story, worked by hand from the sessions above with one decided
   * point outside the matches. Four-balls: B 2, A 1. Singles decided: A 1+½+1
   * = 2½, B 1+½ = 1½ — the fifth singles is still on the course and counts
   * for nobody. Cup: A 3½, B 3½ in the matches, plus the outside point to B.
   */
  const story = (verdict: Parameters<typeof reportStory>[0]["verdict"]) =>
    reportStory({
      teams: ["Ardlui", "Balfron"],
      score: [3.5, 4.5],
      verdict,
      sessions,
      outside: [
        { label: "Team net total", points: 1, side: "B" },
        { label: "Longest drive", points: 1, side: null },
      ],
    });

  it("the story says who won, each session's score, the stars, the last hole and the other points", () => {
    expect(story({ kind: "won", by: "B" })).toEqual([
      "Balfron won the cup 4½ – 3½. Balfron took the four-balls 2 – 1 and Ardlui took the singles 2½ – 1½.",
      "Two players won every match they played: A6 for Ardlui and B1 for Balfron. " +
        "Three matches went to the last hole. The team net total went to Balfron.",
    ]);
  });

  it("sessions in a row taken by one team name that team once", () => {
    const one = (name: string, winner: "A" | "B") => ({ name, matches: [W(["x"], ["y"], winner, "2&1")] });
    const told = reportStory({
      teams: ["Blues", "Whites"],
      score: [1, 2],
      verdict: { kind: "won", by: "B" },
      sessions: [one("Saturday four-balls", "B"), one("Saturday foursomes", "B"), one("Sunday singles", "A")],
      outside: [],
    })[0];
    expect(told).toBe(
      "Whites won the cup 2 – 1. Whites took Saturday four-balls 1 – 0 and Saturday foursomes 1 – 0, " +
        "and Blues took Sunday singles 1 – 0.",
    );
  });

  it("a point nobody has been given yet is not in the story", () => {
    expect(story({ kind: "won", by: "B" }).join(" ")).not.toMatch(/longest drive/i);
  });

  it("a retained cup, a shared one and an open one each read as what they are", () => {
    expect(story({ kind: "retained", by: "B" })[0]).toMatch(/^Balfron retained the cup, 4½ – 3½\./);
    expect(story({ kind: "tied" })[0]).toMatch(/^The cup finished level, 3½ – 4½\./);
    expect(story({ kind: "open" })[0]).toMatch(/^Ardlui 3½, Balfron 4½, with the cup still to be decided\./);
  });

  it("the ribbon names the winner, and says nothing while the cup is open", () => {
    expect(reportRibbon({ teams: ["Ardlui", "Balfron"], verdict: { kind: "won", by: "A" } })).toBe("Ardlui win the cup");
    expect(reportRibbon({ teams: ["Ardlui", "Balfron"], verdict: { kind: "retained", by: "B" } })).toBe(
      "Balfron retain the cup",
    );
    expect(reportRibbon({ teams: ["Ardlui", "Balfron"], verdict: { kind: "open" } })).toBe("");
  });

  it("a session the club named keeps its capitals; a format word is a common noun", () => {
    expect(sessionInSentence("Singles")).toBe("the singles");
    expect(sessionInSentence("Four-balls")).toBe("the four-balls");
    expect(sessionInSentence("Saturday Foursomes")).toBe("Saturday Foursomes");
  });

  it("a session reads as a programme's format line", () => {
    expect(sessionDescription({ kind: "Four-Ball", basis: "net", holes: 9, nine: "back" })).toBe("Net four-ball, back nine");
    expect(sessionDescription({ kind: "Singles", basis: "both", holes: 9, nine: "front" })).toBe("Net singles, front nine");
    expect(sessionDescription({ kind: "Foursomes", basis: "gross", holes: 18, nine: "full" })).toBe("Gross foursomes, 18 holes");
  });

  it("says how the matches were kept", () => {
    expect(scoringWords(["holes", "holes"])).toBe("Hole by hole");
    expect(scoringWords(["cards"])).toBe("From stroke cards, hole by hole");
    expect(scoringWords(["holes", "cards"])).toBe("Hole by hole, and from stroke cards");
  });

  it("writes a margin as it reads in a sentence", () => {
    expect(marginWords("1 UP")).toBe("1 up");
    expect(marginWords("A/S")).toBe("halved");
    expect(marginWords("3&2")).toBe("3&2");
  });
});

describe("the report of any other tournament", () => {
  const row = { gross: 78, net: 66, points: 38, pts: "4" };

  it("names the figure the board ranked on, and only that one", () => {
    expect(placeFigure(row, { isStroke: true, isStableford: false, isNet: true })).toBe("net 66");
    expect(placeFigure(row, { isStroke: true, isStableford: false, isNet: false })).toBe("gross 78");
    expect(placeFigure(row, { isStroke: true, isStableford: true, isNet: true })).toBe("38 points");
    expect(placeFigure(row, { isStroke: false, isStableford: false, isNet: false })).toBe("4 match points");
  });

  it("a single winner is the champion; a tie at the top is shared, never broken", () => {
    expect(eventRibbon({ completed: true, first: { names: ["Ada"], figure: "net 66" } })).toBe("Champion");
    expect(eventRibbon({ completed: true, first: { names: ["Ada", "Bo"], figure: "net 66" } })).toBe("Shared first place");
    expect(eventRibbon({ completed: false, first: { names: ["Ada"], figure: "net 66" } })).toBe("");
  });

  it("tells a finished medal: the winner, the figure, and second place", () => {
    expect(
      eventStory({
        completed: true,
        first: { names: ["Ada Ferris"], figure: "net 66" },
        second: { names: ["Bo Lund", "Cy Marr"], figure: "net 68" },
        rounds: [{ label: "Round 1", result: "Ada Ferris won on net 66" }],
      }),
    ).toEqual(["Ada Ferris won on net 66. Bo Lund and Cy Marr shared second, on net 68."]);
  });

  it("a tie at the top says it is the committee's to settle, and names no second", () => {
    const told = eventStory({
      completed: true,
      first: { names: ["Ada", "Bo"], figure: "38 points" },
      second: { names: ["Cy"], figure: "36 points" },
      rounds: [],
    })[0];
    expect(told).toBe("Ada and Bo finished level at the top on 38 points. A tie for first place is the committee's to settle.");
  });

  it("a tournament still being played has a leader, not a winner", () => {
    expect(
      eventStory({ completed: false, first: { names: ["Ada"], figure: "net 66" }, second: null, rounds: [] })[0],
    ).toBe("Ada leads on net 66, with the tournament still to finish.");
    expect(
      eventStory({
        completed: false,
        first: { names: ["Ada"], figure: "net 66" },
        second: { names: ["Bo"], figure: "net 68" },
        rounds: [],
      })[0],
    ).toBe("Ada leads on net 66, with the tournament still to finish. Bo is next, on net 68.");
  });

  it("a winner level on the figure with second place won on countback, and says so", () => {
    expect(
      eventStory({
        completed: true,
        first: { names: ["Team 3"], figure: "gross 74" },
        second: { names: ["Team 37"], figure: "gross 74" },
        rounds: [],
      })[0],
    ).toBe("Team 3 won on gross 74, ahead of Team 37 on countback.");
  });

  it("a knockout's champion won matches, not a figure", () => {
    expect(
      eventStory({
        completed: true,
        first: { names: ["Ada"], figure: "" },
        second: { names: ["Bo"], figure: "" },
        rounds: [],
      })[0],
    ).toBe("Ada won. Bo was second.");
  });

  it("several rounds each get their own sentence; one round needs none", () => {
    const told = eventStory({
      completed: true,
      first: { names: ["Ada"], figure: "net 132" },
      second: null,
      rounds: [
        { label: "Round 1", result: "Ada won on net 66" },
        { label: "Round 2", result: "Bo won on net 65." },
      ],
    });
    expect(told[1]).toBe("Round 1: Ada won on net 66. Round 2: Bo won on net 65.");
  });
});
