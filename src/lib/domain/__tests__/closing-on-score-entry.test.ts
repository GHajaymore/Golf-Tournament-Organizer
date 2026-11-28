import { describe, it, expect } from "vitest";
import { playersWithNoCard, noCardReturnedWords, noCardReturnedLabel, closingState } from "../missing-cards";
import { closingWords, closingTickShown, closingKind, matchesState, windowWords } from "../closing-words";
import { storedMatchIsOver } from "../match";
import { unplacedWorking, CITE } from "../figure-working";
import { scoreEntryAsksWhere } from "../venue";
import { releaseView } from "../release-results";
import { readSource } from "../../__tests__/source";

/**
 * CLOSING A ROUND ON SCORE ENTRY (R12): the words and the small rules the redesigned screens read, each worked from what the
 * Rules and the board say rather than from the code's own route.
 */

const field = [
  { id: "a", name: "Zz Ann" },
  { id: "b", name: "Zz Bo" },
  { id: "c", name: "Zz Cy" },
  { id: "d", name: "Zz Di" },
];

describe("who is still owed a card", () => {
  it("is the field, less those who hold a card with a hole on it, less those marked out for the week", () => {
    const owed = playersWithNoCard(field, new Set(["a"]), new Set(["d"]));
    expect(owed.map((p) => p.id)).toEqual(["b", "c"]);
  });

  it("is nobody when every card is in (the control: the same field with none in is all of it)", () => {
    expect(playersWithNoCard(field, new Set(field.map((p) => p.id)), new Set())).toEqual([]);
    expect(playersWithNoCard(field, new Set(), new Set()).map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps the order of the field it was handed", () => {
    const owed = playersWithNoCard([field[2], field[0], field[1]], new Set(), new Set());
    expect(owed.map((p) => p.id)).toEqual(["c", "a", "b"]);
  });
});

describe("No card returned is the board's own sentence, with its Rule", () => {
  it("says what unplacedWorking says for a player with no card in a closed round", () => {
    const board = unplacedWorking({ ranked: false, thru: 0, missedRound: "Round 2" });
    expect(board).not.toBeNull();
    const panel = noCardReturnedWords("Round 2");
    expect(panel.says).toBe(board!.says);
    expect(panel.cite).toBe(board!.cite);
    // Rule 3.3b: a card must be returned and certified; none returned, no score for the round.
    expect(panel.cite).toBe(CITE.noReturn);
    expect(panel.says).toContain("No card was returned for Round 2");
  });

  it("labels the line with the round, so two rounds are never confused", () => {
    expect(noCardReturnedLabel("Round 2")).toBe("No card returned: Round 2");
    expect(noCardReturnedLabel("Round 1")).not.toBe(noCardReturnedLabel("Round 2"));
  });
});

describe("the close section's state, said on its folded line", () => {
  it("says closed, then how many cards are to come, then that they are in", () => {
    expect(closingState(true, 3, "Round 1")).toBe("Round 1 is closed");
    expect(closingState(false, 1, "Round 1")).toBe("1 card to come");
    expect(closingState(false, 2, "Round 1")).toBe("2 cards to come");
    expect(closingState(false, 0, "Round 1")).toBe("Cards are in");
  });
});

describe("what the tick says about itself", () => {
  it("keeps the old screen's whole paragraph word for word, and the short line is a line of it", () => {
    const stroke = closingWords("stroke");
    expect(stroke.whole).toBe(
      "Tell the board the round is over, which makes its result official — the public board reads Final rather than All in. Anybody without a complete card for it is then shown without a place, the same as a card that stopped short — they have not completed the competition. Leave it unticked while cards are still coming in.",
    );
    expect(stroke.short.length).toBeLessThan(stroke.whole.length);
    expect(stroke.whole.startsWith(stroke.short.replace(/\.$/, ""))).toBe(true);
    const points = closingWords("points");
    expect(points.whole).toContain("changes nobody's position");
    expect(points.whole.startsWith(points.short.replace(/\.$/, ""))).toBe(true);
  });

  it("is offered for a round with a place to take, and not for a bracket or a round of match points", () => {
    expect(closingTickShown({ type: "Stroke Play Round", format: "Stroke Play", scoringBasis: "gross" })).toBe(true);
    expect(closingTickShown({ type: "Bracket Stage", format: "Match Play", scoringBasis: "gross" })).toBe(false);
    expect(closingTickShown({ type: "Round Robin", format: "Match Play", scoringBasis: "gross" })).toBe(false);
  });
});

describe("a round played as matches speaks in matches (B113)", () => {
  const fourBall = { format: "Four-Ball", scoringBasis: "gross", scoreInput: null };
  const NOT_A_MATCH_WORD = /\b(cards?|places?|strokes?)\b/i;

  it("is chosen from how the round is played, tapped or on cards, not from the format's engine", () => {
    // Four-Ball's engine counts strokes (`standingsUnit`), but a cup session of four-balls is matches either way.
    expect(closingKind({ ...fourBall, type: "Team Session", matchKeptBy: "holes" })).toBe("match");
    expect(closingKind({ ...fourBall, type: "Team Session", matchKeptBy: "cards" })).toBe("match");
    expect(closingKind({ ...fourBall, type: "Team Session", matchKeptBy: null })).toBe("match");
  });

  it("CONTROL: a four-ball MEDAL is not matches, and keeps the stroke words; a Stableford round keeps the points words", () => {
    expect(closingKind({ ...fourBall, type: "Stroke Play Round", matchKeptBy: null })).toBe("stroke");
    expect(closingKind({ type: "Stroke Play Round", format: "Stableford", scoringBasis: "stableford", scoreInput: null, matchKeptBy: null })).toBe("points");
  });

  it("says the match words, with no card or place anywhere in them", () => {
    const m = closingWords("match");
    expect(m.short).toBe("Tell the board this round's matches are over.");
    expect(m.whole).toBe(
      "Tell the board this round's matches are over, which makes its results official. A match that isn't finished keeps the holes it has, and the committee decides it. Leave it unticked while matches are still on the course.",
    );
    expect(m.whole.startsWith(m.short.replace(/\.$/, ""))).toBe(true);
    for (const said of [m.short, m.whole, m.closedNote ?? ""]) expect(said).not.toMatch(NOT_A_MATCH_WORD);
    // It says nothing about taps after the close: that is undecided (side finding A), so it is not promised.
    expect(m.whole + (m.closedNote ?? "")).not.toMatch(/\btap/i);
    // CONTROL: the stroke words DO say card and place, so the pattern above can fail.
    expect(closingWords("stroke").whole).toMatch(NOT_A_MATCH_WORD);
  });

  it("counts matches finished: 'finished' is by holes or a forfeit, so the caller counts storedMatchIsOver", () => {
    expect(matchesState(false, 1, 2, "Round 2")).toBe("1 of 2 matches finished");
    expect(matchesState(false, 0, 2, "Round 2")).toBe("0 of 2 matches finished");
    expect(matchesState(false, 2, 2, "Round 2")).toBe("All 2 matches finished");
    expect(matchesState(false, 1, 1, "Round 2")).toBe("The match is finished");
    expect(matchesState(false, 0, 1, "Round 2")).toBe("0 of 1 match finished");
    expect(matchesState(true, 1, 2, "Round 2")).toBe("Round 2 is closed");
    expect(matchesState(false, 0, 0, "Round 2")).toBe("Open");
    for (const s of [matchesState(false, 1, 2, "R"), matchesState(false, 2, 2, "R"), matchesState(true, 1, 2, "Round 2")]) {
      expect(s).not.toMatch(NOT_A_MATCH_WORD);
    }
  });

  it("a match is finished by holes (3&2 is over after 16) or a forfeit, never by the count of holes entered", () => {
    const won32 = JSON.stringify([...Array(3).fill("A"), ...Array(13).fill("H"), null, null]);
    const live = JSON.stringify([...Array(4).fill("A"), ...Array(14).fill(null)]);
    expect(storedMatchIsOver({ holes: won32 })).toBe(true);
    expect(storedMatchIsOver({ holes: live })).toBe(false);
    expect(storedMatchIsOver({ holes: JSON.stringify(Array(18).fill(null)), forfeitedBy: "team-a" })).toBe(true);
  });
});

describe("Played at is asked where each pairing arranges its own venue", () => {
  it("is not asked of a fixed course on the redesigned screen, and is asked of an open one", () => {
    expect(scoreEntryAsksWhere({ onlyForOpenCourse: true, openCourse: false })).toBe(false);
    expect(scoreEntryAsksWhere({ onlyForOpenCourse: true, openCourse: true })).toBe(true);
  });

  it("CONTROL: the old screen asks as it always did, whatever the course mode", () => {
    expect(scoreEntryAsksWhere({ onlyForOpenCourse: false, openCourse: false })).toBe(true);
    expect(scoreEntryAsksWhere({ onlyForOpenCourse: false, openCourse: true })).toBe(true);
  });
});

describe("Results has one verb for the last act: the machine's own label", () => {
  const LABEL = "Make results final";
  const complete = { kind: "complete" as const, label: LABEL, href: "/dashboard", enabled: true, disabledBecause: null, asks: null };
  const detail = "Every round closed · results not released";

  it("offers the machine's label, pointing at the machine's press, once play is over, to the Organizer", () => {
    const v = releaseView("play-over", complete, detail, true);
    expect(v.kind).toBe("ready");
    if (v.kind === "ready") {
      expect(v.verb).toBe(LABEL);
      expect(v.href).toBe("/dashboard");
      // What ended play is the machine's, with its tail left off, and there is no second word for the act.
      expect(v.says).toContain("Every round closed.");
      expect(v.says).not.toMatch(/release/i);
    }
  });

  it("says what ended play in the event's own words (a knockout's final is not a round)", () => {
    expect(releaseView("play-over", complete, "Final decided · results not released", true).says).toContain("Final decided.");
  });

  it("the label is the one the Dashboard's button draws: read from the machine, never held here", () => {
    expect(readSource("src/lib/domain/tournament-status.ts")).toContain(`label: "${LABEL}"`);
    expect(readSource("src/lib/domain/release-results.ts")).not.toContain(LABEL);
  });

  it("shows no control to anybody but the Organizer", () => {
    expect(releaseView("play-over", complete, detail, false).kind).toBe("blocked");
    const reopen = { ...complete, kind: "reopen" as const, label: "Reopen tournament" };
    const v = releaseView("completed", reopen, "", false);
    expect(v.kind === "final" && v.reopen).toBeNull();
  });

  it("says the machine's own reason when it is refused, and offers no verb", () => {
    const v = releaseView("play-over", { ...complete, enabled: false, disabledBecause: "A result is disputed." }, detail, true);
    expect(v).toEqual({ kind: "blocked", says: "A result is disputed." });
  });

  it("carries the machine's question, so the card can say that it asks first", () => {
    const v = releaseView("play-over", { ...complete, asks: "Round 2 has no scores." }, detail, true);
    expect(v.kind === "ready" && v.asks).toBe("Round 2 has no scores.");
  });

  it("offers no verb while there is golf to close", () => {
    for (const step of ["setting-up", "live"] as const) expect(releaseView(step, null, "", true).kind).toBe("later");
  });

  it("says the results are final once completed, with the way back to correct a card", () => {
    const reopen = { ...complete, kind: "reopen" as const, label: "Reopen tournament" };
    const v = releaseView("completed", reopen, "", true);
    expect(v.kind).toBe("final");
    expect(v.kind === "final" && v.reopen?.href).toBe("/dashboard");
    // The control: a completed tournament that may not be reopened offers no way back.
    const locked = releaseView("completed", { ...reopen, enabled: false, disabledBecause: "x" }, "", true);
    expect(locked.kind === "final" && locked.reopen).toBeNull();
  });
});

describe("the scoring window words (B132)", () => {
  it("a match round waits for its last match, never a card it does not have", () => {
    const w = windowWords("match");
    expect(w.extended).toContain("once the last match is finished.");
    expect(w.keptOpen).toContain("once the last match is finished.");
    expect(w.extended + w.keptOpen).not.toMatch(/card/i);
  });

  it("a stroke or points round still waits for its last card", () => {
    for (const kind of ["stroke", "points"] as const) {
      expect(windowWords(kind).extended).toContain("once the last card is in.");
      expect(windowWords(kind).keptOpen).toContain("once the last card is in.");
    }
  });
});
