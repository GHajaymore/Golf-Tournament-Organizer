import { describe, it, expect } from "vitest";
import {
  acrossRounds,
  COMPLETED_DATES,
  COMPLETED_ROUNDS,
  drawsDifferently,
  filesMatches,
  goesWithItWords,
  handicapMoves,
  MOVES_NAMED,
  recomputedLine,
  redrawWords,
  rescoreWords,
  roundChangeAllowed,
  roundChangeFactsOf,
  roundDoors,
  roundRefusals,
  roundStepOf,
  teesFrozenWords,
  type RoundChangeFacts,
  type RoundChangeRound,
} from "../round-change";
import { round as roundOf, facts as factsOf } from "./tournament-facts-fixtures";
import { cutsMadeAfter } from "../cut-ready";

/**
 * THE ROUNDS-AND-FORMAT RULE (J12, state machine PR 7b) — each row of section
 * 3's table, read off the table and the Golf Pro's answers, never off the
 * function. The matrix (`matrix.test.ts`, "an upstream edit to a round") walks
 * every format × stage type × step × field size; this holds the words and the
 * edges one at a time.
 */

const medal = (over: Partial<RoundChangeRound> = {}): RoundChangeRound => ({
  id: "r2",
  label: "Round 2",
  type: "Stroke Play Round",
  format: "Stroke Play",
  playing: true,
  hasResult: false,
  matches: 0,
  teeSheetSaved: false,
  cutMadeAfter: false,
  ...over,
});
const at = (round: RoundChangeRound, status = "live"): RoundChangeFacts => ({ status, round });
/** No cut made out of any round. */
const NONE: ReadonlySet<string> = new Set();

describe("a cut already made out of a round (8 Nov)", () => {
  it("refuses its allowance and basis after scores, in the coordinator's words, pointing at the cut's undo", () => {
    const cut = medal({ label: "Round 1", hasResult: true, cutMadeAfter: true });
    expect(roundChangeAllowed(at(cut), { kind: "allowance" })).toEqual({
      ok: false,
      scope: "rounds",
      step: "after-scores",
      says: "The cut after Round 1 was made on these figures. Undo the cut first, then change it: untick “This round is finished” on Round 1.",
      wayOut: { says: "Untick “This round is finished” on its card", href: "/stages" },
    });
    // Its tees are refused after scores anyway (option C), in their own words.
    for (const kind of ["round-tees", "field-tees"] as const) expect(roundChangeAllowed(at(cut), { kind })).toMatchObject({ ok: false, says: teesFrozenWords("Round 1") });
    // Its day is not a figure the cut was made on; completed still says Reopen.
    expect(roundChangeAllowed(at(cut), { kind: "day" })).toMatchObject({ ok: true, warn: "schedules" });
    expect(roundChangeAllowed(at(cut, "completed"), { kind: "allowance" })).toMatchObject({ ok: false, says: COMPLETED_ROUNDS });
  });
  it("reads the cut from the one answer: the round a made cut came OUT of, not the round it went into", () => {
    const f = factsOf({ status: "live", rounds: [roundOf({ id: "r1", position: 0, hasResult: true }), roundOf({ id: "r2", position: 1 })] });
    const stages = [
      { id: "r1", position: 0, type: "Stroke Play Round", format: "Stroke Play", cutEnabled: false, cutMadeAt: null, closedAt: new Date("2026-11-07T18:00:00Z") },
      { id: "r2", position: 1, type: "Stroke Play Round", format: "Stroke Play", cutEnabled: true, cutMadeAt: new Date("2026-11-07T18:00:00Z"), closedAt: null },
    ];
    const made = cutsMadeAfter(stages);
    expect([...made]).toEqual(["r1"]);
    expect(roundChangeFactsOf(f, "r1", made)?.round.cutMadeAfter).toBe(true);
    expect(roundChangeFactsOf(f, "r2", made)?.round.cutMadeAfter).toBe(false);
    // Reopened (Round 1 not closed): the cut is undone, and the change is asked again, not refused.
    const reopened = cutsMadeAfter(stages.map((s) => (s.id === "r1" ? { ...s, closedAt: null } : s)));
    expect(reopened.size).toBe(0);
    expect(roundChangeAllowed(roundChangeFactsOf(f, "r1", reopened)!, { kind: "allowance" })).toMatchObject({ ok: true, warn: "rescore" });
  });
});

describe("a round's holes, 18 ↔ 9: open · open · refuse · refuse (8 Nov, format-like)", () => {
  it("open before scores, launched or not; refused with scores, both ways, and once completed", () => {
    expect(roundChangeAllowed(at(medal(), "live"), { kind: "holes" })).toMatchObject({ ok: true, warn: null });
    expect(roundChangeAllowed(at(medal({ teeSheetSaved: true })), { kind: "holes" })).toMatchObject({ ok: true, warn: null });
    expect(roundChangeAllowed(at(medal({ hasResult: true })), { kind: "holes" })).toEqual({
      ok: false,
      scope: "rounds",
      step: "after-scores",
      says: "Round 2 has scores; at another length its cards would mean something else. Clear its scores on Score entry first.",
      wayOut: { says: "Clear its scores on Score entry", href: "/entry" },
    });
    expect(roundChangeAllowed(at(medal(), "completed"), { kind: "holes" })).toMatchObject({ ok: false, says: COMPLETED_ROUNDS });
  });
});

describe("the step is the round's, from its facts", () => {
  it("none drawn · drawn (tee sheet or pairings) · scored · completed — launch is not a step", () => {
    expect(roundStepOf(at(medal(), "draft"))).toBe("before-draw");
    expect(roundStepOf(at(medal(), "live"))).toBe("before-draw");
    expect(roundStepOf(at(medal({ teeSheetSaved: true })))).toBe("after-draw");
    expect(roundStepOf(at(medal({ type: "Round Robin", format: "Match Play", matches: 6, teeSheetSaved: null })))).toBe("after-draw");
    // A result before launch (D2) is still a result.
    expect(roundStepOf(at(medal({ hasResult: true }), "draft"))).toBe("after-scores");
    expect(roundStepOf(at(medal({ hasResult: true }), "completed"))).toBe("completed");
  });
});

describe("the allowance, split and basis: open · open · warn with a confirm · refuse", () => {
  it("open before scores, launched or not", () => {
    for (const r of [medal(), medal({ teeSheetSaved: true })]) {
      for (const status of ["draft", "live"]) expect(roundChangeAllowed(at(r, status), { kind: "allowance" })).toEqual({ ok: true, scope: "rounds", step: roundStepOf(at(r, status)), warn: null });
    }
  });
  it("after scores, a round of cards is asked and worked out again (Rule 20.2d: the Committee corrects its own error)", () => {
    expect(roundChangeAllowed(at(medal({ hasResult: true })), { kind: "allowance" })).toEqual({ ok: true, scope: "rounds", step: "after-scores", warn: "rescore" });
    // A round robin set to Stroke Play files cards: a medal, worked out again.
    expect(roundChangeAllowed(at(medal({ type: "Round Robin", format: "Stroke Play", hasResult: true })), { kind: "allowance" })).toMatchObject({ ok: true, warn: "rescore" });
  });
  it("after scores, a round of recorded MATCHES is refused — a decided match is not worked out again (Rule 3.2a(5))", () => {
    const v = roundChangeAllowed(at(medal({ type: "Round Robin", format: "Four-Ball", hasResult: true, matches: 4 })), { kind: "allowance" });
    expect(v).toEqual({
      ok: false,
      scope: "rounds",
      step: "after-scores",
      says: "Round 2’s matches were played off these strokes. Clear its scores on Score entry first.",
      wayOut: { says: "Clear its scores on Score entry", href: "/entry" },
    });
  });
  it("completed: refused, with Reopen", () => {
    expect(roundChangeAllowed(at(medal({ hasResult: true }), "completed"), { kind: "allowance" })).toEqual({
      ok: false,
      scope: "rounds",
      step: "completed",
      says: COMPLETED_ROUNDS,
      wayOut: { says: "Reopen it on the dashboard", href: "/dashboard" },
    });
  });
});

/**
 * A ROUND'S TEES AFTER PLAY (option C, 8 Nov): its handicaps were frozen off its
 * tees at its first card, and the index they were frozen with is not stored —
 * so the change is REFUSED, never re-frozen from today's index. The way out is
 * the round's scores cleared: a player's own figure cannot be set by hand on a
 * scored round (`setRoundHandicapOverride` refuses there).
 */
describe("a round's own tees or course: open · open · refuse · refuse (option C)", () => {
  it("open before scores, launched or not — a change before scores is frozen normally at the first card", () => {
    for (const r of [medal(), medal({ teeSheetSaved: true })]) {
      for (const status of ["draft", "live"]) expect(roundChangeAllowed(at(r, status), { kind: "round-tees" })).toMatchObject({ ok: true, warn: null });
    }
  });
  it("after scores on a round of cards: refused, the way out the round's scores cleared", () => {
    expect(roundChangeAllowed(at(medal({ label: "Round 1", hasResult: true })), { kind: "round-tees" })).toEqual({
      ok: false,
      scope: "rounds",
      step: "after-scores",
      says: "Round 1’s handicaps were frozen off its tees at its first card. Clear Round 1’s scores on Score entry first.",
      wayOut: { says: "Clear its scores on Score entry", href: "/entry" },
    });
  });
  it("after scores on a round of matches: refused as a recorded match; completed: Reopen", () => {
    expect(roundChangeAllowed(at(medal({ type: "Round Robin", format: "Match Play", hasResult: true, matches: 2 })), { kind: "round-tees" })).toMatchObject({ ok: false, says: "Round 2’s matches were played off these strokes. Clear its scores on Score entry first." });
    expect(roundChangeAllowed(at(medal(), "completed"), { kind: "round-tees" })).toMatchObject({ ok: false, says: COMPLETED_ROUNDS });
  });
});

describe("the tournament's, a flight's or a player's tees reach every round", () => {
  const tournament = (rounds: ReturnType<typeof roundOf>[], status = "live") => factsOf({ status, rounds });

  it("before any card: open", () => {
    expect(acrossRounds(tournament([roundOf({ id: "a", position: 0 })]), { kind: "field-tees" }, NONE)).toMatchObject({ ok: true, warn: null });
  });
  it("refused while a scored round of cards would be reached, naming it; a round of matches alone keeps its frozen strokes", () => {
    const v = acrossRounds(
      tournament([
        roundOf({ id: "b", position: 0, type: "Bracket Stage", format: "Match Play", hasResult: true, teeSheetSaved: null }),
        roundOf({ id: "a", position: 1, hasResult: true }),
        roundOf({ id: "d", position: 2 }),
      ]),
      { kind: "field-tees" },
      NONE,
    );
    expect(v).toMatchObject({ ok: false, says: teesFrozenWords("Round 2"), wayOut: { href: "/entry" } });
    const matchesOnly = acrossRounds(tournament([roundOf({ id: "b", position: 0, type: "Bracket Stage", format: "Match Play", hasResult: true, teeSheetSaved: null }), roundOf({ id: "d", position: 1 })]), { kind: "field-tees" }, NONE);
    expect(matchesOnly).toMatchObject({ ok: true, warn: null });
  });
  it("completed refuses, with no rounds at all as well as with some", () => {
    expect(acrossRounds(tournament([roundOf({ id: "a", position: 0, hasResult: true })], "completed"), { kind: "field-tees" }, NONE)).toMatchObject({ ok: false, says: COMPLETED_ROUNDS });
    expect(acrossRounds(tournament([], "completed"), { kind: "field-tees" }, NONE)).toMatchObject({ ok: false, says: COMPLETED_ROUNDS });
    expect(acrossRounds(tournament([], "live"), { kind: "field-tees" }, NONE)).toMatchObject({ ok: true });
  });
  it("a round the field does not play is not asked", () => {
    const v = acrossRounds(tournament([roundOf({ id: "a", position: 0, playing: false, hasResult: true }), roundOf({ id: "b", position: 1 })]), { kind: "field-tees" }, NONE);
    expect(v).toMatchObject({ ok: true });
  });
});

describe("a round's format: open · re-draw where it draws differently · refuse both ways · refuse", () => {
  const rr = (over: Partial<RoundChangeRound> = {}) => medal({ type: "Round Robin", format: "Match Play", teeSheetSaved: null, ...over });

  it("before the draw anything goes", () => {
    expect(roundChangeAllowed(at(rr()), { kind: "format", to: "Stroke Play" })).toMatchObject({ ok: true, warn: null });
  });
  it("after the draw: a round robin of matches set to Stroke Play becomes a medal — its pairings stop counting (re-draw)", () => {
    expect(drawsDifferently("Round Robin", "Match Play", "Stroke Play")).toBe(true);
    expect(roundChangeAllowed(at(rr({ matches: 6 })), { kind: "format", to: "Stroke Play" })).toEqual({ ok: true, scope: "rounds", step: "after-draw", warn: "redraw" });
    // And back: a medal round robin becoming matches must have its pairings drawn.
    expect(roundChangeAllowed(at(rr({ format: "Stroke Play", teeSheetSaved: true })), { kind: "format", to: "Match Play" })).toMatchObject({ ok: true, warn: "redraw" });
  });
  it("after the draw, the same draw: open (Stroke Play to Stableford on a medal; one match format for another)", () => {
    expect(drawsDifferently("Stroke Play Round", "Stroke Play", "Stableford")).toBe(false);
    expect(roundChangeAllowed(at(medal({ teeSheetSaved: true })), { kind: "format", to: "Stableford" })).toMatchObject({ ok: true, warn: null });
    expect(roundChangeAllowed(at(rr({ matches: 6 })), { kind: "format", to: "Four-Ball" })).toMatchObject({ ok: true, warn: null });
  });
  it("after scores: refused BOTH ways (Golf Pro Q5 — Rule 21.1b picks up for 0 points; Rule 3.3b(3) disqualifies a missing hole in stroke play)", () => {
    const toStroke = roundChangeAllowed(at(medal({ format: "Stableford", hasResult: true })), { kind: "format", to: "Stroke Play" });
    expect(toStroke).toEqual({
      ok: false,
      scope: "rounds",
      step: "after-scores",
      says: "Round 2 was scored as Stableford; its cards would mean something else. Clear its scores on Score entry first.",
      wayOut: { says: "Clear its scores on Score entry", href: "/entry" },
    });
    const toStableford = roundChangeAllowed(at(medal({ hasResult: true })), { kind: "format", to: "Stableford" });
    expect(toStableford).toMatchObject({ ok: false, says: "Round 2 was scored as Stroke Play; its cards would mean something else. Clear its scores on Score entry first." });
  });
  it("re-choosing the round's own format is no change, at any step but completed", () => {
    expect(roundChangeAllowed(at(medal({ hasResult: true })), { kind: "format", to: "Stroke Play" })).toMatchObject({ ok: true, warn: null });
    expect(roundChangeAllowed(at(medal({ hasResult: true }), "completed"), { kind: "format", to: "Stroke Play" })).toMatchObject({ ok: false });
  });
  it("the re-draw in words, both directions", () => {
    expect(redrawWords("Round 2", true)).toBe("Round 2 is now played as matches, so its pairings must be drawn. Generate them on its card.");
    expect(redrawWords("Round 2", false)).toBe("Round 2 is now played on cards, so its pairings no longer decide anything. Its groups go out from the tee sheet.");
    expect(filesMatches({ type: "Round Robin", format: "Stroke Play" })).toBe(false);
    expect(filesMatches({ type: "Round Robin", format: "Match Play" })).toBe(true);
  });
});

describe("deleting a round: open · warn with a confirm · refuse · refuse", () => {
  it("an undrawn round goes on one press, launched or not", () => {
    expect(roundChangeAllowed(at(medal(), "live"), { kind: "delete" })).toMatchObject({ ok: true, warn: null });
  });
  it("a drawn round is asked first, and the question says what goes with it", () => {
    expect(roundChangeAllowed(at(medal({ teeSheetSaved: true })), { kind: "delete" })).toMatchObject({ ok: true, warn: "goes-with-it" });
    expect(goesWithItWords(medal({ teeSheetSaved: true }))).toBe("Round 2’s tee sheet goes with it.");
    expect(goesWithItWords(medal({ matches: 6, teeSheetSaved: null }))).toBe("Round 2’s pairings go with it.");
    expect(goesWithItWords(medal({ matches: 6, teeSheetSaved: true }))).toBe("Round 2’s pairings and tee sheet go with it.");
  });
  it("a round with scores is refused with the panel's words — before launch too", () => {
    for (const status of ["draft", "live"]) {
      expect(roundChangeAllowed(at(medal({ hasResult: true }), status), { kind: "delete" })).toEqual({
        ok: false,
        scope: "rounds",
        step: "after-scores",
        says: "Round 2 has scores. Clear them on Score entry first.",
        wayOut: { says: "Clear its scores on Score entry", href: "/entry" },
      });
    }
  });
});

describe("a round's day: open · open · warn · refuse (section 3, 'Name, dates, venue')", () => {
  it("is the details' part, said after scores and refused once completed", () => {
    expect(roundChangeAllowed(at(medal({ teeSheetSaved: true })), { kind: "day" })).toEqual({ ok: true, scope: "details", step: "after-draw", warn: null });
    expect(roundChangeAllowed(at(medal({ hasResult: true })), { kind: "day" })).toEqual({ ok: true, scope: "details", step: "after-scores", warn: "schedules" });
    expect(roundChangeAllowed(at(medal({ hasResult: true }), "completed"), { kind: "day" })).toMatchObject({ ok: false, says: COMPLETED_DATES });
  });
});

describe("the doors the Rounds screen draws", () => {
  it("are the rule's refusals, round by round", () => {
    expect(roundDoors(at(medal()))).toEqual({ allowance: null, "round-tees": null, format: null, holes: null, delete: null, day: null });
    expect(roundDoors(at(medal({ hasResult: true })))).toEqual({
      allowance: null,
      "round-tees": "Round 2’s handicaps were frozen off its tees at its first card. Clear Round 2’s scores on Score entry first.",
      format: "Round 2 was scored as Stroke Play; its cards would mean something else. Clear its scores on Score entry first.",
      holes: "Round 2 has scores; at another length its cards would mean something else. Clear its scores on Score entry first.",
      delete: "Round 2 has scores. Clear them on Score entry first.",
      day: null,
    });
    const done = roundDoors(at(medal({ hasResult: true }), "completed"));
    expect(Object.values(done).every((d) => d !== null)).toBe(true);
  });
});

describe("every round's refusal of one change — what Score entry draws its Tees from, and what setStageCourse refuses with", () => {
  // Round G594-1 (10 Nov): Tees offered on a scored medal at Score entry, every pick refused.
  // The words are written out here, not taken from `teesFrozenWords`, so a change to the
  // sentence the organizer reads shows here first.
  const R1_FROZEN = "Round 1’s handicaps were frozen off its tees at its first card. Clear Round 1’s scores on Score entry first.";
  const two = (status: string, r1: Partial<ReturnType<typeof roundOf>>) =>
    factsOf({ status, rounds: [roundOf({ id: "r1", position: 0, ...r1 }), roundOf({ id: "r2", position: 1 })] });

  it("a round with a card is shut, with the sentence; the round beside it with none is open (absent from the map)", () => {
    const shut = roundRefusals(two("live", { hasResult: true }), { kind: "round-tees" }, NONE);
    expect([...shut]).toEqual([["r1", R1_FROZEN]]);
    expect(shut.get("r2")).toBeUndefined();
  });
  it("no card anywhere: nothing is shut — drawn, launched or not", () => {
    for (const status of ["draft", "registration", "ready", "live"]) {
      expect(roundRefusals(two(status, { teeSheetSaved: true, matches: 2 }), { kind: "round-tees" }, NONE).size, status).toBe(0);
    }
  });
  it("completed shuts every round, in the completed words", () => {
    const done = roundRefusals(two("completed", {}), { kind: "round-tees" }, NONE);
    expect(Object.fromEntries(done)).toEqual({ r1: COMPLETED_ROUNDS, r2: COMPLETED_ROUNDS });
  });
  it("a scored round of MATCHES is shut in the matches' words, not the frozen tees'", () => {
    const m = roundRefusals(two("live", { type: "Round Robin", format: "Match Play", hasResult: true }), { kind: "round-tees" }, NONE);
    expect(m.get("r1")).toBe("Round 1’s matches were played off these strokes. Clear its scores on Score entry first.");
  });
  it("is the one verdict, round by round: each entry is `roundChangeAllowed`'s own sentence, for every change it judges", () => {
    // Round 1 scored, and a cut made out of it — so the allowance answers with the cut's words.
    const f = two("live", { hasResult: true });
    for (const ask of [{ kind: "round-tees" }, { kind: "allowance" }, { kind: "holes" }, { kind: "delete" }, { kind: "format", to: "Stableford" }] as const) {
      const map = roundRefusals(f, ask, new Set(["r1"]));
      for (const r of f.rounds) {
        const v = roundChangeAllowed(roundChangeFactsOf(f, r.id, new Set(["r1"]))!, ask);
        expect(map.get(r.id) ?? null, `${ask.kind} on ${r.id}`).toBe(v.ok ? null : v.says);
      }
    }
  });
});

describe("the confirm, and what moved", () => {
  it("the Golf Pro's sentence (Q2), with the count of cards", () => {
    expect(rescoreWords(["Round 2"], 14)).toBe(
      "This changes a term of the competition after play. Every net score in Round 2 (14 cards) is worked out again. Money is final-only, so nothing paid changes.",
    );
    expect(rescoreWords(["Round 1", "Round 3"], 1)).toContain("Every net score in Round 1 and Round 3 (1 card) is worked out again.");
  });
  it("a move is a figure that changed; a player on one list only did not move", () => {
    const before = [
      { playerId: "p1", figure: 13 },
      { playerId: "p2", figure: 9 },
      { playerId: "p3", figure: 0 },
    ];
    const after = [
      { playerId: "p1", figure: 11 },
      { playerId: "p2", figure: 9 },
      { playerId: "p4", figure: 20 },
    ];
    expect(handicapMoves(before, after)).toEqual([{ playerId: "p1", from: 13, to: 11 }]);
  });
  it("the audit line says what changed, how many cards, and who moved — capped, by id", () => {
    expect(recomputedLine("Round 2: handicap allowance 95% → 85%", ["Round 2"], 14, [{ playerId: "p1", from: 13, to: 11 }])).toBe(
      "Round 2: handicap allowance 95% → 85% after play. 14 cards in Round 2 worked out again. Playing handicaps moved: p1 13 → 11.",
    );
    expect(recomputedLine("X", ["Round 1"], 1, [])).toBe("X after play. 1 card in Round 1 worked out again; no playing handicap moved.");
    expect(recomputedLine("X", ["Round 1"], 2, null)).toBe("X after play. 2 cards in Round 1 worked out again, each side’s handicap with them.");
    const many = Array.from({ length: MOVES_NAMED + 3 }, (_, i) => ({ playerId: `p${i}`, from: i, to: i + 1 }));
    expect(recomputedLine("X", ["Round 1"], 9, many)).toMatch(/, and 3 more\.$/);
  });
});
