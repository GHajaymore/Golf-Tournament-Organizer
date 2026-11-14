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
    for (const scoringBasis of bases) expect(needsCommitteeFigure({ scoringBasis }, none, nobody), scoringBasis).toBe(true);
    expect(needsCommitteeFigure({ scoringBasis: "net" }, none, { override: null, frozen: null })).toBe(true);
  });

  it("never in a gross round (any spelling the reader of the basis accepts)", () => {
    for (const scoringBasis of ["gross", " Gross ", "GROSS"]) expect(needsCommitteeFigure({ scoringBasis }, none, nobody), scoringBasis).toBe(false);
  });

  it("never for a player with an index — manual, ghin, or a row from before the source was kept", () => {
    for (const handicapSource of ["manual", "ghin", null]) {
      expect(needsCommitteeFigure({ scoringBasis: "net" }, { handicapSource }, nobody), String(handicapSource)).toBe(false);
    }
  });

  it("not once strokes are given — scratch (0) is a figure, not the absence of one", () => {
    expect(needsCommitteeFigure({ scoringBasis: "net" }, none, { override: 18, frozen: null })).toBe(false);
    expect(needsCommitteeFigure({ scoringBasis: "net" }, none, { override: 0, frozen: null })).toBe(false);
  });

  it("not once the round has frozen what they play off: a round played keeps it", () => {
    expect(needsCommitteeFigure({ scoringBasis: "net" }, none, { override: null, frozen: 0 })).toBe(false);
  });
});

describe("the words say what the app does — PR A's set until the sink is live", () => {
  it("SINK_LIVE is false in PR A: a player with no figure is still scored off 0, so the words say so", () => {
    expect(SINK_LIVE).toBe(false);
  });

  it("to staff: 'you', the true consequence, and a link", () => {
    const said = needsFigureSaid({ count: 3, rounds: ["Round 1"], canGive: true, sinkLive: false });
    expect(said).toEqual({
      text: "3 players have no handicap index and Round 1 is scored net. Until you give them strokes they are scored as scratch, off 0.",
      link: true,
    });
  });

  it("to anybody else: names the organizer and carries no link", () => {
    const said = needsFigureSaid({ count: 1, rounds: ["Round 1", "Round 2"], canGive: false, sinkLive: false });
    expect(said.link).toBe(false);
    expect(said.text).toBe("1 player has no handicap index and Round 1 and Round 2 are scored net. Until the organizer gives them strokes they are scored as scratch, off 0.");
    expect(said.text).not.toMatch(/committee/i);
  });

  it("PR B's set says the cards wait — and never 'scratch'", () => {
    const said = needsFigureSaid({ count: 2, rounds: ["Round 1"], canGive: true, sinkLive: true });
    expect(said.text).toContain("Their cards wait, with no net score, until you give them strokes.");
    expect(said.text).not.toContain("scratch");
    expect(needsFigureTodo(2, ["Round 1"], true)).not.toContain("scratch");
  });

  it("PR A's set never claims the cards wait or score nothing", () => {
    for (const s of [
      needsFigureSaid({ count: 2, rounds: ["Round 1"], canGive: true, sinkLive: false }).text,
      needsFigureTodo(2, ["Round 1"], false),
    ]) {
      expect(s).toContain("scratch, off 0");
      expect(s).not.toMatch(/wait|no net score|score nothing/);
    }
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
        { label: "Round 1", players: [{ id: "a" }, { id: "b" }] },
        { label: "Round 2", players: [{ id: "a" }] },
        { label: "Round 3", players: [] },
      ]),
    ).toEqual({ players: 2, rounds: ["Round 1", "Round 2"] });
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
});
