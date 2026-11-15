import { describe, it, expect } from "vitest";
import {
  BAND_REFUSAL,
  SINK_LIVE,
  bandStrokes,
  figureGivenSaid,
  needsCommitteeFigure,
  needsFigureSaid,
  needsFigureTodo,
  needsStrokesFact,
  strokesJobSaid,
  scoredAsScratch,
  mayCorrectStrokes,
  scratchJobSaid,
  scratchPlayedSaid,
  correctionAuditLine,
  correctionConfirmSaid,
  matchResultStored,
  netSideGamePlayers,
  bandSideGameLeadSaid,
} from "../committee-figure";
import { jobHref, whatsNext, type TournamentJobFacts } from "../needs-you-now";
import { playingHandicapPartsInRound } from "../../round-allowance";

/**
 * A PLAYER WITH NO HANDICAP INDEX IN A ROUND SCORED NET (lane N, PR A).
 *
 * The Rules: a Course Handicap is worked from a Handicap Index (Rules of Handicapping 6.1) — nought is a
 * scratch golfer's index, not "none" — and in a handicap competition the Committee works out the strokes
 * (Rules of Golf 3.3b(4)). So the committee is asked, in a round scored net only, until it has given a
 * figure or the round has frozen one.
 */
describe("needsCommitteeFigure — the truth table", () => {
  const none = { handicapSource: "none" };
  const nobody = null;
  const bases = ["net", " Net ", "both", "stableford", "NET"];

  it("asks in every round scored net, for a player with no index and nothing given or frozen", () => {
    for (const scoringBasis of bases) expect(needsCommitteeFigure({ scoringBasis, netGame: false }, none, nobody), scoringBasis).toBe(true);
    expect(needsCommitteeFigure({ scoringBasis: "net", netGame: false }, none, { override: null, frozen: null })).toBe(true);
  });

  it("never in a gross round (any spelling the reader of the basis accepts)", () => {
    for (const scoringBasis of ["gross", " Gross ", "GROSS"]) expect(needsCommitteeFigure({ scoringBasis, netGame: false }, none, nobody), scoringBasis).toBe(false);
  });

  it("never for a player with an index — manual, ghin, or a row from before the source was kept", () => {
    for (const handicapSource of ["manual", "ghin", null]) {
      expect(needsCommitteeFigure({ scoringBasis: "net", netGame: false }, { handicapSource }, nobody), String(handicapSource)).toBe(false);
    }
  });

  it("not once strokes are given — scratch (0) is a figure, not the absence of one", () => {
    expect(needsCommitteeFigure({ scoringBasis: "net", netGame: false }, none, { override: 18, frozen: null })).toBe(false);
    expect(needsCommitteeFigure({ scoringBasis: "net", netGame: false }, none, { override: 0, frozen: null })).toBe(false);
  });

  it("not once the round has frozen what they play off: a round played keeps it", () => {
    expect(needsCommitteeFigure({ scoringBasis: "net", netGame: false }, none, { override: null, frozen: 0 })).toBe(false);
  });

  /**
   * GROSS ROUND, NET POT (review of #1144, C2). A skins pot is net by default and low net is net on any
   * round; both price the player through the board's chain off the stored 0. So the round's basis is not the
   * whole question: a player in a net side game on a gross round has nothing to work strokes from either.
   */
  it("in a gross round, asks for a player who plays a net side game in it — and only them", () => {
    expect(needsCommitteeFigure({ scoringBasis: "gross", netGame: true }, none, nobody)).toBe(true);
    expect(needsCommitteeFigure({ scoringBasis: "gross", netGame: false }, none, nobody), "no net game: gross asks nothing").toBe(false);
    expect(needsCommitteeFigure({ scoringBasis: "gross", netGame: true }, { handicapSource: "ghin" }, nobody), "an index needs nothing").toBe(false);
    expect(needsCommitteeFigure({ scoringBasis: "gross", netGame: true }, none, { override: 9, frozen: null }), "given").toBe(false);
    expect(scoredAsScratch({ scoringBasis: "gross", netGame: true }, none, { override: null, frozen: 0 })).toBe(true);
    expect(mayCorrectStrokes({ scoringBasis: "gross", netGame: true }, none)).toBe(true);
    expect(mayCorrectStrokes({ scoringBasis: "gross", netGame: false }, none)).toBe(false);
  });
});

describe("who is in a net side game (netSideGamePlayers, through potMembership)", () => {
  const field = ["a", "b", "c", "d"];
  it("a net skins pot: its rows, paid or asked; a gross pot: nobody", () => {
    const pot = { net: true, mode: "opt-in" as const, audience: field, decisions: [{ playerId: "a", confirmed: true, excluded: false }, { playerId: "b", confirmed: false, excluded: false }] };
    expect([...netSideGamePlayers([pot])].sort()).toEqual(["a", "b"]);
    expect([...netSideGamePlayers([{ ...pot, net: false }])]).toEqual([]);
  });
  it("an opt-out low net: everybody in its audience but the one who took themselves out", () => {
    const low = { net: true, mode: "opt-out" as const, audience: ["a", "b", "c"], decisions: [{ playerId: "c", confirmed: true, excluded: true }] };
    expect([...netSideGamePlayers([low])].sort()).toEqual(["a", "b"]);
  });
});

describe("the words say what the app does — PR A's set until the sink is live", () => {
  it("SINK_LIVE is false in PR A: a player with no figure is still scored from a stored index 0, so the words say so", () => {
    expect(SINK_LIVE).toBe(false);
  });

  it("to staff: 'you', the true consequence, and a link", () => {
    const said = needsFigureSaid({ count: 3, rounds: ["Round 1"], sideGameRounds: [], canGive: true, sinkLive: false });
    expect(said).toEqual({
      text: "3 players have no handicap index and Round 1 is scored net. Until you give them strokes they are scored as a scratch golfer (handicap index 0).",
      link: true,
    });
  });

  it("to anybody else: names the organizer and carries no link", () => {
    const said = needsFigureSaid({ count: 1, rounds: ["Round 1", "Round 2"], sideGameRounds: [], canGive: false, sinkLive: false });
    expect(said.link).toBe(false);
    expect(said.text).toBe("1 player has no handicap index and Round 1 and Round 2 are scored net. Until the organizer gives them strokes they are scored as a scratch golfer (handicap index 0).");
    expect(said.text).not.toMatch(/committee/i);
  });

  it("PR B's set says the cards wait — and never 'scratch'", () => {
    const said = needsFigureSaid({ count: 2, rounds: ["Round 1"], sideGameRounds: [], canGive: true, sinkLive: true });
    expect(said.text).toContain("Their cards wait, with no net score, until you give them strokes.");
    expect(said.text).not.toContain("scratch");
    expect(needsFigureTodo(2, ["Round 1"], true)).not.toContain("scratch");
  });

  it("PR A's set never claims the cards wait or score nothing", () => {
    for (const s of [
      needsFigureSaid({ count: 2, rounds: ["Round 1"], sideGameRounds: [], canGive: true, sinkLive: false }).text,
      needsFigureTodo(2, ["Round 1"], false),
    ]) {
      expect(s).toContain("scored as a scratch golfer (handicap index 0)");
      expect(s, "off 0 is false on rated tees whose Course Rating is not par").not.toContain("off 0");
      expect(s).not.toMatch(/wait|no net score|score nothing/);
    }
  });

  it("a gross round with a net side game is never said to be 'scored net'", () => {
    expect(needsFigureSaid({ count: 1, rounds: ["Round 1"], sideGameRounds: ["Round 1"], canGive: true, sinkLive: false }).text).toBe(
      "1 player has no handicap index and plays a net side game in Round 1. Until you give them strokes they are scored as a scratch golfer (handicap index 0).",
    );
    const mixed = needsFigureSaid({ count: 2, rounds: ["Round 1", "Round 2"], sideGameRounds: ["Round 2"], canGive: false, sinkLive: false }).text;
    expect(mixed).toBe("2 players have no handicap index and play net in Round 1 and Round 2. Until the organizer gives them strokes they are scored as a scratch golfer (handicap index 0).");
    expect(mixed).not.toContain("scored net");
    expect(bandSideGameLeadSaid(false)).toContain("net side game");
    expect(bandSideGameLeadSaid(false)).not.toContain("scored net");
    expect(
      needsStrokesFact([
        { label: "Round 1", sideGame: false, players: [{ id: "a" }] },
        { label: "Round 2", sideGame: true, players: [{ id: "b" }] },
      ]),
    ).toEqual({ players: 2, rounds: ["Round 1", "Round 2"], sideGameRounds: ["Round 2"] });
  });

  it("What's next: who, the round and its day", () => {
    expect(strokesJobSaid(3, "Round 1", "Sat 21 Nov")).toBe("3 players need strokes from you for Round 1 (Sat 21 Nov)");
    expect(strokesJobSaid(1, "Round 2", "")).toBe("1 player needs strokes from you for Round 2");
  });
});

describe("the band's box: whole strokes, 0 to 54", () => {
  it("takes 0 to 54", () => {
    expect(bandStrokes("18")).toEqual({ ok: true, value: 18 });
    expect(bandStrokes("0")).toEqual({ ok: true, value: 0 });
    expect(bandStrokes("54")).toEqual({ ok: true, value: 54 });
  });
  it("refuses a decimal, a plus figure, 55 and words, in one sentence", () => {
    for (const raw of ["12.4", "+2", "55", "-1", "twelve"]) expect(bandStrokes(raw), raw).toEqual({ ok: false, error: BAND_REFUSAL });
  });
  it("says nothing of an empty box", () => {
    expect(bandStrokes("")).toBeNull();
    expect(bandStrokes("  ")).toBeNull();
  });
});

describe("after Give: the consequence, priced by the board's own calculation", () => {
  /**
   * WORKED FROM THE RULE, in whole numbers, by a route the code does not take: 18 strokes at 95% is
   * 18 × 95 = 1710 hundredths, 17.10, rounded once (6.2a, Appendix C) to 17. With one stroke for tees of a
   * higher par (6.2b), added after the allowance and never reduced by it: 18.
   */
  const medal = { format: "Stroke Play", type: "Stroke Play Round", scoringBasis: "net", handicapAllowance: 95 };
  it("18 strokes at 95% plays off 17; with a stroke for a higher par, 18", () => {
    const flat = playingHandicapPartsInRound(medal, { override: 18 }, { whole: 0, exact: 0, parStrokes: 0 });
    expect(flat.allowance).toBe(95);
    expect(flat.playing).toBe(17);
    expect(figureGivenSaid({ name: "Zz Okello", strokes: 18, playing: flat.playing, allowance: flat.allowance, round: "Round 1" })).toBe(
      "Zz Okello: 18 strokes, given by you. At 95% plays off 17 in Round 1.",
    );
    expect(playingHandicapPartsInRound(medal, { override: 18 }, { whole: 0, exact: 0, parStrokes: 1 }).playing).toBe(18);
  });
});

describe("the list as one fact, and the What's next line", () => {
  it("counts each player once across rounds, names the rounds", () => {
    expect(needsStrokesFact([])).toBeNull();
    expect(
      needsStrokesFact([
        { label: "Round 1", sideGame: false, players: [{ id: "a" }, { id: "b" }] },
        { label: "Round 2", sideGame: false, players: [{ id: "a" }] },
        { label: "Round 3", sideGame: false, players: [] },
      ]),
    ).toEqual({ players: 2, rounds: ["Round 1", "Round 2"], sideGameRounds: [] });
  });

  const status = { step: "setting-up", chipDetail: "", underWayUnlaunched: false, nextAction: null, rounds: [] } as unknown as TournamentJobFacts["status"];
  const base: TournamentJobFacts = {
    eventId: "e1",
    name: "zz-strokes Medal",
    awaitingApproval: 0,
    entriesClose: "",
    nextSheet: null,
    board: null,
    status,
    startOn: "2026-11-21",
    endOn: "2026-11-21",
  };

  it("one line, due on the round's day, opening the band", () => {
    const jobs = whatsNext({
      tournaments: [{ ...base, strokes: { roundId: "r1", round: "Round 1", day: "2026-11-21", count: 3 } }],
      today: "2026-11-14",
      locale: "en-GB",
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].key).toBe("strokes");
    expect(jobs[0].text).toMatch(/^3 players need strokes from you for Round 1 \(.*21.*Nov.*\)$/);
    expect(jobs[0].due).toBe("2026-11-21");
    expect(jobHref(jobs[0])).toBe("/stages?round=r1#needs-strokes");
  });

  it("no line when nobody needs strokes", () => {
    expect(whatsNext({ tournaments: [{ ...base, strokes: null }], today: "2026-11-14", locale: "en-GB" })).toEqual([]);
    expect(whatsNext({ tournaments: [{ ...base, strokes: { roundId: "r1", round: "Round 1", day: "", count: 0 } }], today: "2026-11-14", locale: "en-GB" })).toEqual([]);
  });

  it("a player frozen at the scratch figure is a line too, today, with the correction", () => {
    const jobs = whatsNext({ tournaments: [{ ...base, scratch: { roundId: "r1", round: "Round 1", count: 1 } }], today: "2026-11-14", locale: "en-GB" });
    expect(jobs.map((j) => [j.key, j.text, j.action, j.due, jobHref(j)])).toEqual([
      ["strokes", "1 player with no handicap index is scored as a scratch golfer (handicap index 0) in Round 1", "Correct the strokes", "2026-11-14", "/stages?round=r1#needs-strokes"],
    ]);
  });
});

describe("frozen at the scratch figure by the first card: still named, and correctable by staff", () => {
  const none = { handicapSource: "none" };
  it("scoredAsScratch: net, no index, nothing given, something frozen — and nothing else", () => {
    expect(scoredAsScratch({ scoringBasis: "net", netGame: false }, none, { override: null, frozen: 0 })).toBe(true);
    expect(scoredAsScratch({ scoringBasis: "net", netGame: false }, none, { override: null, frozen: 2 })).toBe(true);
    expect(scoredAsScratch({ scoringBasis: "net", netGame: false }, none, { override: 14, frozen: 14 }), "a given figure, frozen, is the committee's").toBe(false);
    expect(scoredAsScratch({ scoringBasis: "net", netGame: false }, none, null), "nothing frozen: still a Give").toBe(false);
    expect(scoredAsScratch({ scoringBasis: "gross", netGame: false }, none, { override: null, frozen: 0 })).toBe(false);
    expect(scoredAsScratch({ scoringBasis: "net", netGame: false }, { handicapSource: "manual" }, { override: null, frozen: 0 })).toBe(false);
  });

  it("the two never both answer yes: a player is either to be given strokes or to be corrected", () => {
    for (const row of [null, { override: null, frozen: null }, { override: null, frozen: 0 }, { override: 3, frozen: null }, { override: 3, frozen: 3 }]) {
      const both = needsCommitteeFigure({ scoringBasis: "net", netGame: false }, none, row) && scoredAsScratch({ scoringBasis: "net", netGame: false }, none, row);
      expect(both, JSON.stringify(row)).toBe(false);
    }
  });

  it("mayCorrectStrokes: only a player with no index, only in a round scored net", () => {
    expect(mayCorrectStrokes({ scoringBasis: "stableford", netGame: false }, none)).toBe(true);
    expect(mayCorrectStrokes({ scoringBasis: "gross", netGame: false }, none)).toBe(false);
    expect(mayCorrectStrokes({ scoringBasis: "net", netGame: false }, { handicapSource: "ghin" })).toBe(false);
  });

  it("the confirm says who, from what, to what, and what is worked out again", () => {
    expect(correctionConfirmSaid("Zz Okello", 14, "Round 1")).toBe(
      "Zz Okello: from a scratch golfer (handicap index 0) to 14 strokes in Round 1. Their net, points and place in Round 1 are worked out again.",
    );
  });

  it("a match has a result stored once a hole is recorded or it is conceded — never on an empty or unreadable card", () => {
    expect(matchResultStored({ holes: "[]", forfeitedBy: "" })).toBe(false);
    expect(matchResultStored({ holes: JSON.stringify(new Array(18).fill(null)), forfeitedBy: "" })).toBe(false);
    expect(matchResultStored({ holes: JSON.stringify(["A", ...new Array(17).fill(null)]), forfeitedBy: "" })).toBe(true);
    expect(matchResultStored({ holes: "[]", forfeitedBy: "p1" })).toBe(true);
    expect(matchResultStored({ holes: "not json", forfeitedBy: null })).toBe(false);
  });

  it("the band and the audit line: what happened, the way on, and old, new and why", () => {
    expect(scratchJobSaid(2, "Round 1")).toBe("2 players with no handicap index are scored as a scratch golfer (handicap index 0) in Round 1");
    expect(scratchPlayedSaid("Zz Okello", "Round 1")).toContain("Correct the strokes, with a reason.");
    expect(correctionAuditLine({ name: "Zz Okello", round: "Round 1", from: 2, to: 14, reason: "Card shown at the desk" })).toBe(
      "Strokes corrected for Zz Okello (no handicap index) in Round 1: 2 to 14, the committee's figure. Reason: Card shown at the desk",
    );
  });
});
