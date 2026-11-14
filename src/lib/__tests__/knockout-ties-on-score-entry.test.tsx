import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildBracket, flightKind } from "@/lib/domain/bracket";
import { laterTieRefusal, scoreEntryTies, tieItFeeds, goesThroughWords, type Draws } from "@/lib/domain/knockout-ties";
import type { Player } from "@/lib/domain/types";

vi.mock("@/app/actions/tournament", () => ({ recordTieResult: vi.fn(), approveBracketReport: vi.fn(), rejectBracketReport: vi.fn() }));
vi.mock("@/app/actions/knockout-results", () => ({ undoTieResult: vi.fn() }));

const { KnockoutTies } = await import("@/components/KnockoutTies");

/**
 * KNOCKOUT TIES ON SCORE ENTRY (simplicity review, cut 3, 2026-11-14).
 *
 * The pure parts: which ties Score entry lists and in what order, and when a
 * result may still be taken back. The server's use of the rule is the audit
 * test's (`a-knockout-result-is-taken-back-on-the-record.audit.test.ts`); every
 * field size and order is the matrix's ("taking a knockout result back").
 */

const field = (prefix: string, n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, name: `${prefix.toUpperCase()} Invented ${i + 1}`, handicap: i, seed: i + 1 }));

/** Three flights, as a flighted knockout files them (`flightKind`): the third is the one a two-flight test cannot see. */
function threeFlights(winners: Record<string, string>): Draws {
  return [0, 1, 2].map((i) => ({
    label: `Flight ${i + 1}`,
    view: buildBracket(flightKind(i), field(`f${i}p`, 4), winners),
  }));
}

describe("the tie a result goes on to", () => {
  it("is the next round's tie at half the place", () => {
    const view = buildBracket("winners", field("p", 8), {});
    expect(tieItFeeds(view, view.rounds[0].matches[3])?.key).toBe("winners-1-1");
    expect(tieItFeeds(view, view.rounds[1].matches[0])?.key).toBe("winners-2-0");
    expect(tieItFeeds(view, view.rounds[2].matches[0])).toBeNull();
  });
});

describe("a result may be changed or taken back only while its winner has not played on", () => {
  it("is free while the tie it feeds has no result", () => {
    const view = buildBracket("winners", field("p", 4), { "winners-0-0": "p1" });
    expect(laterTieRefusal([{ label: "", view }], "winners-0-0", { plate: false })).toBeNull();
  });

  it("is refused once the tie it feeds has a result, naming that tie and the way out", () => {
    // 1 v 4 and 2 v 3; both semi-finals in, and the final.
    const view = buildBracket("winners", field("p", 4), { "winners-0-0": "p1", "winners-0-1": "p2", "winners-1-0": "p2" });
    const said = laterTieRefusal([{ label: "", view }], "winners-0-0", { plate: false });
    expect(said).toBe(
      "Final: P Invented 1 v P Invented 2 already has a result, and it was played by this tie's winner. Undo that result first, then change this one.",
    );
    // The final itself feeds nothing and may be taken back.
    expect(laterTieRefusal([{ label: "", view }], "winners-1-0", { plate: false })).toBeNull();
  });

  it("holds in every flight, the third included, and only in its own", () => {
    const draws = threeFlights({
      "flight3-0-0": "f2p1",
      "flight3-0-1": "f2p2",
      "flight3-1-0": "f2p1",
      "winners-0-0": "f0p1",
    });
    expect(laterTieRefusal(draws, "flight3-0-0", { plate: false })).toMatch(/^Flight 3 · Final: /);
    expect(laterTieRefusal(draws, "winners-0-0", { plate: false })).toBeNull();
    expect(laterTieRefusal(draws, "consolation-0-0", { plate: false })).toBeNull();
  });

  it("holds the main draw's first round once its plate has a result", () => {
    const main = buildBracket("winners", field("p", 8), { "winners-0-0": "p1", "winners-0-1": "p4", "winners-0-2": "p3", "winners-0-3": "p2" });
    const losers = main.rounds[0].matches.map((m) => field("p", 8).find((p) => p.id === (m.winnerId === m.a.playerId ? m.b.playerId : m.a.playerId))!);
    const plate = buildBracket("consolation", losers, { "consolation-0-0": losers[0].id }, false);
    const draws = [
      { label: "Main draw", view: main },
      { label: "Plate", view: plate },
    ];
    expect(laterTieRefusal(draws, "winners-0-2", { plate: true })).toBe(
      "Plate is drawn from this round's losers, and it has results. Undo the plate's results first, then change this one.",
    );
    // Not a plate (two flights): the second draw has nothing to do with the first's losers.
    expect(laterTieRefusal(draws, "winners-0-2", { plate: false })).toBeNull();
  });
});

describe("the ties as Score entry lists them", () => {
  it("lists reported ties first, then ties to play, then decided ones, every flight included; byes and TBD seats get no row", () => {
    // Flight 1 of 4: one semi decided. Flight 3 of 4: a report on its first semi.
    const draws = threeFlights({ "winners-0-0": "f0p1" });
    const { ties, waiting } = scoreEntryTies(
      draws,
      [{ key: "flight3-0-0", winnerId: "f2p4", result: "2&1", reportedBy: "F2P Invented 4" }],
      { "winners-0-0": "3 and 2" },
    );
    expect(ties.map((t) => `${t.state}:${t.key}`)).toEqual([
      "reported:flight3-0-0",
      "to-play:winners-0-1",
      "to-play:consolation-0-0",
      "to-play:consolation-0-1",
      "to-play:flight3-0-1",
      "decided:winners-0-0",
    ]);
    // Three finals, each with a TBD seat.
    expect(waiting).toBe(3);
    expect(ties[0].round).toBe("Flight 3 · Semi-finals");
    expect(ties[0].report).toEqual({ winnerId: "f2p4", winner: "F2P Invented 4", margin: " 2&1", reportedBy: "F2P Invented 4" });
    expect(ties.at(-1)?.margin).toBe(" 3&2");
  });

  it("leaves out a first-round bye, which nobody plays", () => {
    // Five in a draw of eight: seeds 1, 3 and 2 have byes, so 4 v 5 is the one
    // first-round tie, 3 v 2 is ready in the semi-finals, and 1 waits on 4 v 5.
    const { ties, waiting } = scoreEntryTies([{ label: "", view: buildBracket("winners", field("p", 5), {}) }], [], {});
    expect(ties.map((t) => t.key)).toEqual(["winners-0-1", "winners-1-1"]);
    expect(waiting).toBe(2);
  });

  it("sets aside a report whose winner is no longer in the tie", () => {
    const { ties } = scoreEntryTies([{ label: "", view: buildBracket("winners", field("p", 4), {}) }], [{ key: "winners-0-0", winnerId: "p2", result: "", reportedBy: "x" }], {});
    expect(ties.find((t) => t.key === "winners-0-0")?.state).toBe("to-play");
  });

  it("says who goes through", () => {
    expect(goesThroughWords({ a: { id: "a", name: "Ann Ash" }, b: { id: "b", name: "Bob Birch" } }, "b")).toBe("Bob Birch goes through.");
  });
});

describe("the list on the screen", () => {
  const { ties, waiting } = scoreEntryTies(
    threeFlights({ "winners-0-0": "f0p1" }),
    [{ key: "flight3-0-0", winnerId: "f2p4", result: "2&1", reportedBy: "F2P Invented 4" }],
    {},
  );
  const html = renderToStaticMarkup(<KnockoutTies ties={ties} waiting={waiting} />);
  const rows = html.split("<li ").slice(1);

  it("names both players on a tie's two buttons, and offers no Halved (Rule 3.2a(4))", () => {
    const toPlay = rows.find((r) => r.includes('data-tie="winners-0-1"'))!;
    expect(toPlay).toContain(">F0P Invented 2 won</button>");
    expect(toPlay).toContain(">F0P Invented 3 won</button>");
    expect(html).not.toMatch(/halve/i);
    expect(html).toContain("Level? Play on; record the winner when it is decided.");
  });

  it("puts Approve on the reported tie and a Needs approval chip at the top that jumps to it", () => {
    expect(html).toContain('href="#tie-flight3-0-0"');
    expect(html).toContain("Needs approval (1)");
    const reported = rows.find((r) => r.includes('data-tie="flight3-0-0"'))!;
    expect(reported).toContain("Reported by F2P Invented 4");
    expect(reported).toContain(">Approve</button>");
  });

  it("keeps Change result on a decided tie, with no name buttons to tap again", () => {
    const decided = rows.find((r) => r.includes('data-tie="winners-0-0"'))!;
    expect(decided).toContain(">Change result</button>");
    expect(decided).not.toContain(" won</button>");
  });

  it("draws no Needs approval chip when nothing is reported", () => {
    const quiet = renderToStaticMarkup(<KnockoutTies ties={ties.filter((t) => t.state !== "reported")} waiting={0} />);
    expect(quiet).not.toContain("Needs approval");
  });
});
