import { describe, expect, it } from "vitest";
import { cupMatchState, cupPoints, cupTally, cupVerdict, lineupNotices, pointsToWin, yourMatchLine, type CupMatchInput } from "../cup";
import type { HoleResult } from "../types";

/**
 * THE TEAM CUP'S ARITHMETIC, asserted against how a golfer scores a Ryder Cup:
 * a point a match, ½ each for a halve, a match decided when one side leads by
 * more holes than remain (Rule 3.2a(3)), and the cup won at the target.
 */
const card = (s: string): HoleResult[] =>
  [...s.padEnd(18, "-")].map((c) => (c === "-" ? null : (c as HoleResult)));
const m = (s: string, conceded: CupMatchInput["conceded"] = null): CupMatchInput => ({ holes: card(s), conceded });

describe("one match", () => {
  it("is decided the moment the lead exceeds the holes left (Rule 3.2a(3))", () => {
    // A wins 1-4 then halves: four up after the 15th with three to play is
    // over there — 4&3 — even though the card carries a 16th.
    const s = cupMatchState(m("AAAA" + "H".repeat(12)));
    expect(s).toMatchObject({ points: [1, 0], status: "final", leader: "A" });
    expect(s.label).toBe("4&3");
  });

  it("a halved match is half a point each", () => {
    const s = cupMatchState(m("AB" + "H".repeat(16)));
    expect(s).toMatchObject({ points: [0.5, 0.5], status: "final", label: "A/S", leader: null });
  });

  it("in play: '2 UP thru 14' for the side in front, and no points yet", () => {
    const s = cupMatchState(m("BB" + "H".repeat(12)));
    expect(s).toMatchObject({ points: [0, 0], status: "in-play", label: "2 UP thru 14", leader: "B" });
  });

  it("dormie: as many holes up as there are left to play", () => {
    // Two up after the 16th: the side behind must win both to halve.
    expect(cupMatchState(m("AA" + "H".repeat(14))).label).toBe("Dormie 2");
    // CONTROL: two up with three to play is not dormie.
    expect(cupMatchState(m("AA" + "H".repeat(13))).label).toBe("2 UP thru 15");
  });

  it("level in play reads A/S thru n", () => {
    expect(cupMatchState(m("AB" + "H".repeat(7))).label).toBe("A/S thru 9");
  });

  it("a conceded match is a full point to the other side", () => {
    expect(cupMatchState(m("AA", "A"))).toMatchObject({ points: [0, 1], status: "final", leader: "B" });
  });

  it("CONTROL: an empty card is not started and worth nothing — not a halve", () => {
    expect(cupMatchState(m(""))).toMatchObject({ points: [0, 0], status: "not-started", label: "" });
  });
});

/**
 * A MATCH FROM YOUR SIDE OF IT — what the player's phone says. The board's
 * "◀ 2 UP" is a direction; a player wants "you're 2 up" or "2 down", and a
 * final result as won or lost, never a team letter.
 */
describe("a match, told to one of its players", () => {
  const st = (s: string, conceded: CupMatchInput["conceded"] = null) => cupMatchState(m(s, conceded));

  it("in play, from either side", () => {
    expect(yourMatchLine(st("AA"), "A")).toBe("You're 2 up thru 2");
    expect(yourMatchLine(st("AA"), "B")).toBe("You're 2 down thru 2");
    expect(yourMatchLine(st("AB"), "B")).toBe("All square thru 2");
  });

  it("dormie, from either side", () => {
    const dormie = st("AA" + "H".repeat(14));
    expect(yourMatchLine(dormie, "A")).toBe("You're dormie 2 — 2 up with 2 to play");
    expect(yourMatchLine(dormie, "B")).toBe("2 down with 2 to play — you need both");
  });

  it("finished: won, lost or halved — with the result a golfer quotes", () => {
    const won = st("AAAA" + "H".repeat(12));
    expect(yourMatchLine(won, "A")).toBe("Won 4&3");
    expect(yourMatchLine(won, "B")).toBe("Lost 4&3");
    expect(yourMatchLine(st("AB" + "H".repeat(16)), "A")).toBe("Halved");
    expect(yourMatchLine(st("AA", "B"), "A")).toBe("Won — conceded");
  });

  it("before a shot", () => {
    expect(yourMatchLine(st(""), "A")).toBe("Not started");
  });
});

/**
 * WHEN A LINEUP IS ANNOUNCED, EVERY PLAYER IN IT IS TOLD — their own match,
 * by name, from their side. Nobody outside the session is.
 */
describe("the lineup notice", () => {
  const session = {
    name: "Saturday foursomes",
    kind: "Foursomes",
    matches: [
      { a: ["Cora Blue", "Dev Blue"], aIds: ["a3", "a4"], b: ["Gwen White", "Hal White"], bIds: ["b3", "b4"] },
    ],
  };

  it("tells all four players, each from their own side", () => {
    const n = lineupNotices(session);
    expect(n.map((x) => x.playerId).sort()).toEqual(["a3", "a4", "b3", "b4"]);
    expect(n.find((x) => x.playerId === "a3")!.body).toBe("You & Dev Blue v Gwen White & Hal White · Saturday foursomes");
    expect(n.find((x) => x.playerId === "b4")!.body).toBe("Gwen White & You v Cora Blue & Dev Blue · Saturday foursomes");
    expect(n[0].title).toBe("Your foursomes match is set");
  });

  it("singles read as singles", () => {
    const n = lineupNotices({
      name: "Sunday singles",
      kind: "Singles",
      matches: [{ a: ["Ailsa Blue"], aIds: ["a1"], b: ["Edda White"], bIds: ["b1"] }],
    });
    expect(n.find((x) => x.playerId === "a1")).toMatchObject({ title: "Your singles match is set", body: "You v Edda White · Sunday singles" });
  });

  it("CONTROL: an empty lineup tells nobody", () => {
    expect(lineupNotices({ ...session, matches: [] })).toEqual([]);
  });
});

describe("the cup", () => {
  it("adds decided matches only — a lead is not a point", () => {
    const t = cupTally([m("AAAA" + "H".repeat(12)), m("AB" + "H".repeat(16)), m("BB")]);
    expect(t).toEqual({ a: 1.5, b: 0.5, total: 3, decided: 2, inPlay: 1, notStarted: 0 });
  });

  it("the target is more than half the points on offer unless the organizer sets one", () => {
    expect(pointsToWin(0, 28)).toBe(14.5);
    expect(pointsToWin(0, 12)).toBe(6.5);
    expect(pointsToWin(0, 5)).toBe(3);
    expect(pointsToWin(10, 28)).toBe(10);
    expect(pointsToWin(0, 0)).toBe(0);
  });

  it("is won the moment a team reaches the target, with matches still out", () => {
    const t = { a: 14.5, b: 9, total: 28, decided: 24, inPlay: 4, notStarted: 0 };
    expect(cupVerdict(t, 0, null)).toEqual({ kind: "won", by: "A" });
  });

  it("a holder retains on a tie; without one it is shared", () => {
    const t = { a: 14, b: 14, total: 28, decided: 28, inPlay: 0, notStarted: 0 };
    expect(cupVerdict(t, 0, "B")).toEqual({ kind: "retained", by: "B" });
    expect(cupVerdict(t, 0, null)).toEqual({ kind: "tied" });
  });

  it("while open, says what each team still needs", () => {
    const t = { a: 8.5, b: 7.5, total: 28, decided: 16, inPlay: 4, notStarted: 8 };
    expect(cupVerdict(t, 0, null)).toEqual({ kind: "open", needA: 6, needB: 7 });
  });

  /**
   * THE HOLDER RETAINS THE MOMENT THE CUP CANNOT BE TAKEN FROM THEM — at 14 of
   * 28, the way every Ryder Cup holder has retained it, with singles still on
   * the course. This waited for the last match, so the board said "Europe
   * need ½" over a cup Europe had already kept.
   */
  it("a holder retains as soon as the challenger cannot reach the target", () => {
    // B hold. 14 each would be a tie at best for A: 14 + 0 left... A has 13,
    // three matches out, so A can reach 16 and the cup is still open.
    expect(cupVerdict({ a: 13, b: 12, total: 28, decided: 25, inPlay: 3, notStarted: 0 }, 0, "B")).toMatchObject({ kind: "open" });
    // B reach 14 with two out: A has 12, can make 14 at most — a tie, which B keep.
    expect(cupVerdict({ a: 12, b: 14, total: 28, decided: 26, inPlay: 2, notStarted: 0 }, 0, "B")).toEqual({ kind: "retained", by: "B" });
    // CONTROL: the same score with NOBODY holding it is not decided — A can still tie.
    expect(cupVerdict({ a: 12, b: 14, total: 28, decided: 26, inPlay: 2, notStarted: 0 }, 0, null)).toMatchObject({ kind: "open" });
  });

  /**
   * "MORE THAN HALF" OF A LINEUP NOT YET MADE IS NOT A TARGET. With Friday's
   * eight matches in and Saturday's not yet set, more than half of eight is
   * 4½ — and a team on 5 was told it had won the cup before the rest of the
   * weekend existed.
   */
  it("with no target set, nothing is decided while a session has no lineup", () => {
    const friday = { a: 5, b: 3, total: 8, decided: 8, inPlay: 0, notStarted: 0 };
    expect(cupVerdict(friday, 0, null, false)).toEqual({ kind: "open", needA: null, needB: null });
    // CONTROL: once every session is lined up, the same arithmetic decides it.
    expect(cupVerdict(friday, 0, null, true)).toEqual({ kind: "won", by: "A" });
    // An explicit target is a target whatever the lineup says.
    expect(cupVerdict({ ...friday, a: 14.5 }, 14.5, null, false)).toEqual({ kind: "won", by: "A" });
  });

  it("writes halves the way a scoreboard does", () => {
    expect(cupPoints(8.5)).toBe("8½");
    expect(cupPoints(0.5)).toBe("½");
    expect(cupPoints(14)).toBe("14");
    expect(cupPoints(0)).toBe("0");
  });
});
